import { chromium } from "playwright";
import fs from "node:fs";
import assert from "node:assert/strict";

const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({acceptDownloads:true});
 const pageErrors=[];const fontResponses=[];
 page.on("pageerror",e=>pageErrors.push(e.message));
 page.on("response",r=>{if(r.url().includes("HindGuntur"))fontResponses.push({url:r.url(),status:r.status()});});
 await page.goto("http://127.0.0.1:8788/",{waitUntil:"networkidle"});
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
 const rows=page.locator(".goal-row");
 const count=await rows.count();
 for(let i=0;i<count;i++){
  await rows.nth(i).locator('[data-f="at"]').fill("1");
  await rows.nth(i).locator('[data-f="cost"]').fill(String(100000+i*50000));
 }
 await page.locator("#sim").evaluate(form=>form.requestSubmit());
 await page.locator("#out:not([hidden])").waitFor({timeout:60000});
 await page.locator("#nudgeCard:not([hidden])").waitFor({timeout:60000});
 const [download]=await Promise.all([
  page.waitForEvent("download",{timeout:60000}),
  page.locator("#pdfReport").click()
 ]);
 const path=await download.path();assert.ok(path,"download file path exists");
 const bytes=fs.readFileSync(path);
 assert.equal(bytes.subarray(0,5).toString("ascii"),"%PDF-","valid PDF header");
 assert.ok(bytes.length>12000,"PDF contains embedded fonts and report content");
 const raw=bytes.toString("latin1");
 assert.ok(raw.includes("HindGuntur"),"PDF embeds Hind Guntur font resource");
 assert.ok(fontResponses.length>=2&&fontResponses.every(x=>x.status===200),"both Telugu font files loaded successfully");
 assert.deepEqual(pageErrors,[],"browser page has no uncaught errors");
 console.log(JSON.stringify({browser:"Chromium headless",pdf_bytes:bytes.length,filename:download.suggestedFilename(),fonts:fontResponses,scenarioLab:"visible",status:"passed"}));
}finally{await browser.close();}
