import com.sun.net.httpserver.*;
import java.net.*;
import java.net.http.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.io.*;
import java.time.Duration;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;

/**
 * Production HTTP gateway for Hisaab financial digital twin.
 * Java 17+. No third-party dependencies.
 *
 * Hardening: security headers, body limits, path normalization,
 * in-memory rate limiting, request timeouts, structured access logs,
 * /healthz and /readyz, configurable bind address.
 */
public final class Hisaab {
  private static final HttpClient HTTP = HttpClient.newBuilder()
      .connectTimeout(Duration.ofSeconds(2))
      .build();
  private static final Path WEB = Path.of("web").toAbsolutePath().normalize();
  private static final int MAX_BODY = 64 * 1024;
  private static final int ENGINE_PORT = Integer.parseInt(
      System.getenv().getOrDefault("HISAAB_ENGINE_PORT", "8081"));
  private static final String BIND = System.getenv().getOrDefault("HISAAB_BIND", "0.0.0.0");
  private static final int RATE_LIMIT_PER_MIN = Integer.parseInt(
      System.getenv().getOrDefault("HISAAB_RATE_LIMIT", "60"));
  private static final AtomicLong REQ_ID = new AtomicLong(1);
  private static final ConcurrentHashMap<String, long[]> RATE = new ConcurrentHashMap<>();
  private static final double[][] SLABS_TY26_27 = {
      {400000, 0}, {800000, .05}, {1200000, .10}, {1600000, .15},
      {2000000, .20}, {2400000, .25}, {Double.MAX_VALUE, .30}
  };
  private static volatile boolean READY = false;

  private static void securityHeaders(Headers h) {
    h.set("X-Content-Type-Options", "nosniff");
    h.set("X-Frame-Options", "DENY");
    h.set("Referrer-Policy", "no-referrer");
    h.set("Permissions-Policy", "geolocation=(), microphone=(), camera=()");
    h.set("Cross-Origin-Opener-Policy", "same-origin");
    h.set("Cross-Origin-Resource-Policy", "same-origin");
    h.set("Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'self'; " +
        "frame-ancestors 'none'; form-action 'self'");
    h.set("Cache-Control", "no-store");
  }

  private static void send(HttpExchange x, int status, String type, byte[] body) throws IOException {
    Headers h = x.getResponseHeaders();
    h.set("Content-Type", type + "; charset=utf-8");
    securityHeaders(h);
    x.sendResponseHeaders(status, body.length);
    try (OutputStream out = x.getResponseBody()) {
      out.write(body);
    }
  }

  private static void json(HttpExchange x, int status, String body) throws IOException {
    send(x, status, "application/json", body.getBytes(StandardCharsets.UTF_8));
  }

  private static void method(HttpExchange x, String allowed) throws IOException {
    x.getResponseHeaders().set("Allow", allowed);
    json(x, 405, "{\"error\":\"Method not allowed\"}");
  }

  private static String clientIp(HttpExchange x) {
    String xf = x.getRequestHeaders().getFirst("X-Forwarded-For");
    if (xf != null && !xf.isBlank()) {
      return xf.split(",")[0].trim();
    }
    InetSocketAddress addr = x.getRemoteAddress();
    return addr == null || addr.getAddress() == null ? "unknown" : addr.getAddress().getHostAddress();
  }

  /** Sliding 60-second window rate limiter per IP. */
  private static boolean allow(String ip) {
    long now = System.currentTimeMillis();
    long window = now / 60_000L;
    long[] slot = RATE.compute(ip, (k, v) -> {
      if (v == null || v[0] != window) return new long[]{window, 1};
      v[1]++;
      return v;
    });
    if (RATE.size() > 10_000) {
      RATE.entrySet().removeIf(e -> e.getValue()[0] < window - 1);
    }
    return slot[1] <= RATE_LIMIT_PER_MIN;
  }

  private static void log(String level, long id, String method, String path, int status, long ms, String ip, String detail) {
    System.out.printf(Locale.ROOT,
        "{\"ts\":\"%s\",\"level\":\"%s\",\"req\":%d,\"method\":\"%s\",\"path\":\"%s\",\"status\":%d,\"ms\":%d,\"ip\":\"%s\",\"msg\":\"%s\"}%n",
        Instant.now(), level, id, method, path, status, ms, ip, detail == null ? "" : detail.replace("\"", "'"));
  }

  private static Map<String, Double> query(String raw) {
    Map<String, Double> m = new HashMap<>();
    if (raw == null || raw.isBlank()) throw new IllegalArgumentException("Missing query parameters");
    for (String pair : raw.split("&")) {
      String[] kv = pair.split("=", 2);
      if (kv.length != 2) throw new IllegalArgumentException("Malformed query parameter");
      String key = URLDecoder.decode(kv[0], StandardCharsets.UTF_8);
      if (!key.matches("[a-zA-Z_]{1,32}")) throw new IllegalArgumentException("Invalid parameter name");
      double value = Double.parseDouble(URLDecoder.decode(kv[1], StandardCharsets.UTF_8));
      if (!Double.isFinite(value)) throw new IllegalArgumentException("Values must be finite numbers");
      m.put(key, value);
    }
    return m;
  }

  private static double required(Map<String, Double> m, String key, double min, double max) {
    Double v = m.get(key);
    if (v == null || v < min || v > max) throw new IllegalArgumentException(key + " is outside its allowed range");
    return v;
  }

  private static double emiCalc(double principal, double annualRate, double years) {
    if (principal < 0 || annualRate < 0 || annualRate > 100 || years <= 0 || years > 40)
      throw new IllegalArgumentException("Loan, rate or tenure is outside its allowed range");
    double months = years * 12, r = annualRate / 1200;
    return r == 0 ? principal / months : principal * r / (1 - Math.pow(1 + r, -months));
  }

  private static double slabTax(double taxable) {
    double tax = 0, lower = 0;
    for (double[] slab : SLABS_TY26_27) {
      if (taxable > lower) tax += (Math.min(taxable, slab[0]) - lower) * slab[1];
      lower = slab[0];
    }
    if (taxable <= 1_200_000) return 0;
    if (taxable <= 1_300_000) tax = Math.min(tax, taxable - 1_200_000);
    return tax * 1.04;
  }

  private static void emi(HttpExchange x) throws IOException {
    if (!x.getRequestMethod().equals("GET")) { method(x, "GET"); return; }
    try {
      Map<String, Double> m = query(x.getRequestURI().getRawQuery());
      double principal = required(m, "loan", 0, 1e12);
      double rate = required(m, "rate", 0, 100);
      double years = required(m, "years", 1.0 / 12, 40);
      double monthly = emiCalc(principal, rate, years);
      double interest = monthly * years * 12 - principal;
      json(x, 200, String.format(Locale.ROOT, "{\"emi\":%.2f,\"interest\":%.2f}", monthly, Math.max(0, interest)));
    } catch (RuntimeException e) {
      json(x, 400, "{\"error\":\"Invalid EMI inputs\"}");
    }
  }

  private static void tax(HttpExchange x) throws IOException {
    if (!x.getRequestMethod().equals("GET")) { method(x, "GET"); return; }
    try {
      Map<String, Double> m = query(x.getRequestURI().getRawQuery());
      double ctc = required(m, "ctc", 0, 5e7);
      double basicPct = required(m, "basic", 0, 100);
      double pt = required(m, "pt", 0, 50000);
      double basic = ctc * basicPct / 100.0;
      double epf = Math.min(basic * 0.12, 1800 * 12);
      double standardDeduction = 75_000;
      double taxable = Math.max(0, ctc - epf - standardDeduction - pt);
      double taxAmt = slabTax(taxable);
      double inhand = ctc - taxAmt - epf - pt;
      json(x, 200, String.format(Locale.ROOT,
          "{\"tax\":%.2f,\"inhand\":%.2f,\"taxable\":%.2f}", taxAmt, Math.max(0, inhand), taxable));
    } catch (RuntimeException e) {
      json(x, 400, "{\"error\":\"Invalid tax inputs\"}");
    }
  }

  private static void simulate(HttpExchange x) throws IOException {
    if (!x.getRequestMethod().equals("POST")) { method(x, "POST"); return; }
    try {
      Headers reqH = x.getRequestHeaders();
      String cl = reqH.getFirst("Content-Length");
      if (cl == null) { json(x, 411, "{\"error\":\"Content-Length required\"}"); return; }
      int length = Integer.parseInt(cl);
      if (length < 1 || length > MAX_BODY) {
        json(x, 413, "{\"error\":\"Request body must be between 1 byte and 64 KB\"}");
        return;
      }
      byte[] body = x.getRequestBody().readNBytes(length);
      if (body.length != length) {
        json(x, 400, "{\"error\":\"Incomplete request body\"}");
        return;
      }
      HttpRequest req = HttpRequest.newBuilder()
          .uri(URI.create("http://127.0.0.1:" + ENGINE_PORT + "/simulate"))
          .timeout(Duration.ofSeconds(25))
          .header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofByteArray(body))
          .build();
      HttpResponse<String> response = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
      json(x, response.statusCode(), response.body());
    } catch (NumberFormatException e) {
      json(x, 400, "{\"error\":\"Invalid request length\"}");
    } catch (java.net.ConnectException e) {
      json(x, 503, "{\"error\":\"Simulation engine is unavailable\"}");
    } catch (java.net.http.HttpTimeoutException e) {
      json(x, 504, "{\"error\":\"Simulation timed out\"}");
    } catch (Exception e) {
      json(x, 502, "{\"error\":\"Simulation service failed\"}");
    }
  }

  private static void healthz(HttpExchange x) throws IOException {
    if (!x.getRequestMethod().equals("GET") && !x.getRequestMethod().equals("HEAD")) {
      method(x, "GET, HEAD");
      return;
    }
    json(x, 200, "{\"status\":\"ok\"}");
  }

  private static void readyz(HttpExchange x) throws IOException {
    if (!x.getRequestMethod().equals("GET") && !x.getRequestMethod().equals("HEAD")) {
      method(x, "GET, HEAD");
      return;
    }
    if (!READY) {
      json(x, 503, "{\"status\":\"starting\"}");
      return;
    }
    try {
      HttpRequest req = HttpRequest.newBuilder()
          .uri(URI.create("http://127.0.0.1:" + ENGINE_PORT + "/healthz"))
          .timeout(Duration.ofSeconds(2))
          .GET()
          .build();
      HttpResponse<String> response = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
      if (response.statusCode() == 200) {
        json(x, 200, "{\"status\":\"ready\"}");
      } else {
        json(x, 503, "{\"status\":\"engine_unhealthy\"}");
      }
    } catch (Exception e) {
      json(x, 503, "{\"status\":\"engine_unreachable\"}");
    }
  }

  private static void staticFiles(HttpExchange x) throws IOException {
    if (!x.getRequestMethod().equals("GET") && !x.getRequestMethod().equals("HEAD")) {
      method(x, "GET, HEAD");
      return;
    }
    try {
      String path = URLDecoder.decode(x.getRequestURI().getPath(), StandardCharsets.UTF_8);
      if (path.contains("\0") || path.contains("\\")) {
        send(x, 400, "text/plain", "Bad request".getBytes(StandardCharsets.UTF_8));
        return;
      }
      if (path.equals("/")) path = "/index.html";
      if (path.contains("..") || path.contains("./") || path.startsWith("/.")) {
        send(x, 404, "text/plain", "Not found".getBytes(StandardCharsets.UTF_8));
        return;
      }
      Path file = WEB.resolve(path.substring(1)).normalize();
      if (!file.startsWith(WEB) || !Files.isRegularFile(file)) {
        send(x, 404, "text/plain", "Not found".getBytes(StandardCharsets.UTF_8));
        return;
      }
      String name = file.getFileName().toString();
      String type;
      if (name.endsWith(".html")) type = "text/html";
      else if (name.endsWith(".css")) type = "text/css";
      else if (name.endsWith(".js")) type = "text/javascript";
      else if (name.endsWith(".svg")) type = "image/svg+xml";
      else if (name.endsWith(".png")) type = "image/png";
      else if (name.endsWith(".ico")) type = "image/x-icon";
      else if (name.endsWith(".woff2")) type = "font/woff2";
      else {
        send(x, 404, "text/plain", "Not found".getBytes(StandardCharsets.UTF_8));
        return;
      }
      byte[] bytes = Files.readAllBytes(file);
      if (x.getRequestMethod().equals("HEAD")) bytes = new byte[0];
      Headers h = x.getResponseHeaders();
      h.set("Content-Type", type + "; charset=utf-8");
      securityHeaders(h);
      if (name.endsWith(".css") || name.endsWith(".js")) {
        h.set("Cache-Control", "public, max-age=300");
      }
      x.sendResponseHeaders(200, bytes.length);
      try (OutputStream out = x.getResponseBody()) {
        out.write(bytes);
      }
    } catch (RuntimeException e) {
      send(x, 400, "text/plain", "Bad request".getBytes(StandardCharsets.UTF_8));
    }
  }


  private static void proxyPost(HttpExchange x, String enginePath) throws IOException {
    if (!x.getRequestMethod().equals("POST")) { method(x, "POST"); return; }
    try {
      String cl = x.getRequestHeaders().getFirst("Content-Length");
      if (cl == null) { json(x, 411, "{\"error\":\"Content-Length required\"}"); return; }
      int length = Integer.parseInt(cl);
      if (length < 1 || length > MAX_BODY) {
        json(x, 413, "{\"error\":\"Request body must be between 1 byte and 64 KB\"}");
        return;
      }
      byte[] body = x.getRequestBody().readNBytes(length);
      HttpRequest req = HttpRequest.newBuilder()
          .uri(URI.create("http://127.0.0.1:" + ENGINE_PORT + enginePath))
          .timeout(Duration.ofSeconds(25))
          .header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofByteArray(body))
          .build();
      HttpResponse<String> response = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
      json(x, response.statusCode(), response.body());
    } catch (NumberFormatException e) {
      json(x, 400, "{\"error\":\"Invalid request length\"}");
    } catch (java.net.ConnectException e) {
      json(x, 503, "{\"error\":\"Simulation engine is unavailable\"}");
    } catch (java.net.http.HttpTimeoutException e) {
      json(x, 504, "{\"error\":\"Request timed out\"}");
    } catch (Exception e) {
      json(x, 502, "{\"error\":\"Upstream service failed\"}");
    }
  }

  private static void proxyGet(HttpExchange x, String enginePath) throws IOException {
    if (!x.getRequestMethod().equals("GET") && !x.getRequestMethod().equals("HEAD")) {
      method(x, "GET, HEAD");
      return;
    }
    try {
      HttpRequest req = HttpRequest.newBuilder()
          .uri(URI.create("http://127.0.0.1:" + ENGINE_PORT + enginePath))
          .timeout(Duration.ofSeconds(5))
          .GET()
          .build();
      HttpResponse<String> response = HTTP.send(req, HttpResponse.BodyHandlers.ofString());
      json(x, response.statusCode(), response.body());
    } catch (Exception e) {
      json(x, 503, "{\"error\":\"Upstream service unavailable\"}");
    }
  }


  private static void proxyPdf(HttpExchange x) throws IOException {
    if (!x.getRequestMethod().equals("POST")) { method(x, "POST"); return; }
    try {
      String cl = x.getRequestHeaders().getFirst("Content-Length");
      if (cl == null) { json(x, 411, "{\"error\":\"Content-Length required\"}"); return; }
      int length = Integer.parseInt(cl);
      if (length < 1 || length > MAX_BODY) {
        json(x, 413, "{\"error\":\"Request body must be between 1 byte and 64 KB\"}");
        return;
      }
      byte[] body = x.getRequestBody().readNBytes(length);
      HttpRequest req = HttpRequest.newBuilder()
          .uri(URI.create("http://127.0.0.1:" + ENGINE_PORT + "/report/pdf"))
          .timeout(Duration.ofSeconds(30))
          .header("Content-Type", "application/json")
          .POST(HttpRequest.BodyPublishers.ofByteArray(body))
          .build();
      HttpResponse<byte[]> response = HTTP.send(req, HttpResponse.BodyHandlers.ofByteArray());
      Headers h = x.getResponseHeaders();
      h.set("Content-Type", "application/pdf");
      h.set("Content-Disposition", "attachment; filename=\"hisaab-report.pdf\"");
      securityHeaders(h);
      x.sendResponseHeaders(response.statusCode(), response.body().length);
      try (OutputStream out = x.getResponseBody()) { out.write(response.body()); }
    } catch (Exception e) {
      json(x, 502, "{\"error\":\"PDF generation failed\"}");
    }
  }

  private static HttpHandler wrap(HttpHandler inner) {
    return x -> {
      long id = REQ_ID.getAndIncrement();
      long start = System.nanoTime();
      String ip = clientIp(x);
      String method = x.getRequestMethod();
      String path = x.getRequestURI().getPath();
      int status = 200;
      try {
        if (!allow(ip)) {
          json(x, 429, "{\"error\":\"Rate limit exceeded. Try again shortly.\"}");
          status = 429;
          return;
        }
        inner.handle(x);
      } catch (Exception e) {
        status = 500;
        try {
          json(x, 500, "{\"error\":\"Internal error\"}");
        } catch (IOException ignored) {}
        log("ERROR", id, method, path, status, (System.nanoTime() - start) / 1_000_000L, ip, e.getClass().getSimpleName());
        return;
      } finally {
        long ms = (System.nanoTime() - start) / 1_000_000L;
        if (status != 500) {
          log("INFO", id, method, path, status, ms, ip, null);
        }
      }
    };
  }

  public static void main(String[] args) throws Exception {
    int httpPort = Integer.parseInt(System.getenv().getOrDefault("HISAAB_HTTP_PORT", "8080"));
    InetSocketAddress addr = new InetSocketAddress(BIND, httpPort);
    HttpServer server = HttpServer.create(addr, 128);
    server.createContext("/api/emi", wrap(Hisaab::emi));
    server.createContext("/api/tax", wrap(Hisaab::tax));
    server.createContext("/api/simulate", wrap(Hisaab::simulate));
    server.createContext("/api/tax/compute", wrap(x -> proxyPost(x, "/tax/compute")));
    server.createContext("/api/tax/compare", wrap(x -> proxyPost(x, "/tax/compare")));
    server.createContext("/api/tax/rules", wrap(x -> proxyGet(x, "/tax/rules")));
    server.createContext("/api/data/snapshot", wrap(x -> proxyGet(x, "/data/snapshot")));
    server.createContext("/api/mitra", wrap(x -> proxyPost(x, "/mitra")));
    server.createContext("/api/report/pdf", wrap(Hisaab::proxyPdf));
    server.createContext("/api/ingestion/status", wrap(x -> proxyGet(x, "/ingestion/status")));
    server.createContext("/api/ingestion/candidates", wrap(x -> proxyGet(x, "/ingestion/candidates")));
    server.createContext("/api/ingestion/monitor", wrap(x -> proxyPost(x, "/ingestion/monitor")));
    server.createContext("/api/ingestion/fetch", wrap(x -> proxyPost(x, "/ingestion/fetch")));
    server.createContext("/api/ingestion/approve", wrap(x -> proxyPost(x, "/ingestion/approve")));
    server.createContext("/api/llm/status", wrap(x -> proxyGet(x, "/llm/status")));
    server.createContext("/healthz", wrap(Hisaab::healthz));
    server.createContext("/readyz", wrap(Hisaab::readyz));
    server.createContext("/", wrap(Hisaab::staticFiles));
    int threads = Math.max(4, Runtime.getRuntime().availableProcessors());
    server.setExecutor(Executors.newFixedThreadPool(threads));
    server.start();
    READY = true;
    System.out.printf(Locale.ROOT,
        "{\"ts\":\"%s\",\"level\":\"INFO\",\"msg\":\"Hisaab gateway ready\",\"bind\":\"%s\",\"port\":%d,\"rate_limit\":%d}%n",
        Instant.now(), BIND, httpPort, RATE_LIMIT_PER_MIN);
  }
}
