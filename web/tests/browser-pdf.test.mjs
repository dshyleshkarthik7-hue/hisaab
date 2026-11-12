import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";
import { extractText } from "pdfnative";

const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({acceptDownloads:true,viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true});
 const page=await context.newPage();
 const pageErrors=[];const consoleErrors=[];const failedRequests=[];
 page.on("pageerror",e=>pageErrors.push(e.message));
 page.on("console",m=>{if(m.type()==="error")consoleErrors.push(m.text());});
 page.on("requestfailed",r=>failedRequests.push({url:r.url(),failure:r.failure()?.errorText}));
 await page.goto("http://127.0.0.1:8788/",{waitUntil:"networkidle"});
 const horizontalOverflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);
 assert.equal(horizontalOverflow,false,"mobile viewport should not have horizontal overflow");
 await page.locator('[name="years"]').fill("1");
 await page.locator('[name="trials"]').fill("100");
 await page.locator('[name="savings"]').fill("500000");
 await page.locator('[name="income"]').fill("100000");
 await page.locator('[name="expense"]').fill("50000");
 await page.locator('[name="sip"]').fill("20000");
 await page.locator('[name="ret"]').fill("8");
 await page.locator('[name="vol"]').fill("12");
 await page.locator('[name="income_growth"]').fill("5");
 await page.locator('[name="medical_shock"]').fill("100000");
 await page.locator('[name="seed"]').fill("42");
 await page.locator(".event-row [data-ev=year]").fill("1");
 const rows=page.locator(".goal-row");
 const count=await rows.count();
 for(let i=0;i<count;i++){
  await rows.nth(i).locator('[data-f="at"]').fill("1");
  await rows.nth(i).locator('[data-f="cost"]').fill(String(100000+i*50000));
 }
 await page.locator("#sim").evaluate(form=>form.requestSubmit());
 try{await page.locator("#out:not([hidden])").waitFor({timeout:60000});}catch(error){console.log(JSON.stringify({pageErrors,consoleErrors,failedRequests,errorBox:await page.locator("#err").textContent(),runButton:await page.locator("#run").textContent(),goals:await page.locator(".goal-row").count()}));throw error;}
 await page.locator("#nudgeCard:not([hidden])").waitFor({timeout:60000});
 await page.locator("#runScenarios").click();
 await page.locator("#findTargetSip").waitFor({state:"visible",timeout:60000});
 await page.locator("#findTargetSip").click();
 await page.waitForFunction(()=>document.querySelector("#targetSip")?.textContent?.includes("Estimated SIP"),null,{timeout:60000});
 await page.locator("#langToggle").click();
 const [download]=await Promise.all([
  page.waitForEvent("download",{timeout:60000}),
  page.locator("#pdfReport").click()
 ]);
 const path=await download.path();assert.ok(path,"download file path exists");
 const bytes=fs.readFileSync(path);
 assert.equal(bytes.subarray(0,5).toString("ascii"),"%PDF-","valid PDF header");
 assert.ok(bytes.length>12000,"PDF contains embedded fonts and report content");
 const extracted=extractText(new Uint8Array(bytes)).map(page=>page.text).join(" ");
 assert.ok(extracted.includes("హిసాబ్"),"PDF text layer preserves Telugu report title");
 assert.ok(extracted.includes("ఆర్థిక"),"PDF text layer preserves Telugu text");

 assert.deepEqual(pageErrors,[],"browser page has no uncaught errors");

 const cdp=await page.context().newCDPSession(page);
 await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
 const benchmark=await page.evaluate(async()=>{
  const input={years:40,trials:10000,savings:5000000,income:150000,sip:40000,expense:80000,ret:8,vol:15,income_growth:5,medical_shock:400000,seed:20261112,shocks:true,goals:[{name:"Education",at:15,cost:2500000,kind:"education",flex:false},{name:"Home",at:25,cost:5000000,kind:"home",flex:true},{name:"Retirement",at:35,cost:10000000,kind:"general",flex:true}]};
  const worker=new Worker(new URL("/src/workers/simulation.worker.bundle.js",location.origin),{type:"module"});
  const start=performance.now();
  try{
   const result=await new Promise((resolve,reject)=>{
    worker.onmessage=event=>{if(event.data.type==="result")resolve(event.data.result);else if(event.data.type==="error")reject(new Error(event.data.message));};
    worker.onerror=event=>reject(new Error(event.message));
    worker.postMessage({type:"baseline",id:77,input});
   });
   return {elapsed_ms:Math.round(performance.now()-start),trials:result.trials,fan_years:result.fan.length,sample_paths:result.sample_paths.length};
  }finally{worker.terminate();}
 });
 assert.equal(benchmark.trials,10000,"throttled browser benchmark trial count");
 assert.equal(benchmark.fan_years,41,"throttled browser benchmark horizon");
 assert.equal(benchmark.sample_paths,25,"throttled browser benchmark paths");
 assert.ok(benchmark.elapsed_ms<90000,"4x-throttled browser benchmark under 90 seconds");

 const throttled=await page.evaluate(async()=>{
  const {simulate}=await import("/src/core/simulation.js");
  const input={years:40,trials:10000,savings:5000000,income:150000,sip:40000,expense:80000,ret:8,vol:15,income_growth:5,medical_shock:400000,seed:20261112,shocks:true,goals:[{name:"Education",at:15,cost:2500000,kind:"education",flex:false},{name:"Home",at:25,cost:5000000,kind:"home",flex:true},{name:"Retirement",at:35,cost:10000000,kind:"general",flex:true}]};
  const start=performance.now();const result=await simulate(input);return {elapsed_ms:Math.round(performance.now()-start),trials:result.trials,fan_years:result.fan.length};
 });
 assert.equal(throttled.trials,10000,"throttled core benchmark trial count");
 assert.equal(throttled.fan_years,41,"throttled core benchmark horizon");
 assert.ok(throttled.elapsed_ms<90000,"4x-throttled core benchmark under 90 seconds");
 console.log(JSON.stringify({browser:"Chromium headless mobile viewport",pdf_bytes:bytes.length,filename:download.suggestedFilename(),scenarioLab:"visible",telugu_text_extraction:"passed",worker_benchmark:benchmark,throttled_core_benchmark:{cpu_rate:4,...throttled},status:"passed"}));


}finally{await browser.close();}
