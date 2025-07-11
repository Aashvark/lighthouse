const { Builder, By, until, Browser, WebDriver } = require("selenium-webdriver");
const Chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const path = require('path');
const process = require('process');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(process.cwd(), 'json/credentials.json');
let range;

const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

async function writeRecord(id, record) {
    const response = google.sheets({ version: 'v4', auth }).spreadsheets.values.append({
      spreadsheetId: id,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [record] },
    });
}

async function getLastRecordIndex(id) {
    const response = await google.sheets({ version: 'v4', auth }).spreadsheets.values.get({
      spreadsheetId: id,
      range: range,
    });
    return await response.data.values[response.data.values.length - 1][0];
}

function getID(DocType) {
    if      (DocType === "PROBATE DOCUMENT")          return '1aMJHHbELPRVvHOvtDIG13wJzv6gfAiQw7WNa-6YEfQg';
    else if (DocType === "LIENS")                     return '187HiafgDVlCLFQaZ0dWZB_5NrA4m9tQeYBAThxd78ZI';
    else if (DocType === "LIS PENDENS")               return '18eUPlKCP5l7FBLcphnHrvwvFsSxgBuon3-3p841aGr4';
    else if (DocType === "NOTICE OF CONTEST OF LIEN") return '1JnSkBDGDPs2fZCAcWcQ7zYreOFwTuIY0GrJbduV_p94';
}

async function pull(DocType, RecordDateFrom, RecordDateTo) {
    const options = new Chrome.Options()
        .excludeSwitches('enable-logging')
        .addArguments("--disable-extensions", "--disable-dev-shm-usage", "--no-sandbox")
        .setPageLoadStrategy("eager")
        .setUserPreferences({
            "download.default_directory": `${__dirname}\\csv\\`,
            "download.prompt_for_download": false,
            "profile.managed_default_content_settings.images": 2
        });

    let driver = await new Builder().forBrowser(Browser.CHROME).setChromeOptions(options).build();
    let index = 0;

    let path = `${__dirname}\\csv\\SearchResults.csv`;
    let newPath = `${__dirname}\\csv\\${DocType.toLowerCase()}\\${RecordDateFrom.replaceAll("/", "-")}-${RecordDateTo.replaceAll("/", "-")}.csv`;
    
    if (!fs.existsSync(newPath)) {
        await driver.get("https://officialrecords.mypinellasclerk.org/search/SearchTypeDocType");
        try {
            await driver.wait(until.elementLocated(By.id("btnButton")), 1000);
            await driver.findElement(By.id("btnButton")).submit();

            await driver.findElement(By.id("DocTypesDisplay-input")).sendKeys(DocType);
            await driver.findElement(By.id("mainBack")).click();
            await driver.findElement(By.id("RecordDateFrom")).clear();
            await driver.findElement(By.id("RecordDateFrom")).sendKeys(RecordDateFrom);
            await driver.findElement(By.id("RecordDateTo")).clear();
            await driver.findElement(By.id("RecordDateTo")).sendKeys(RecordDateTo);

            await driver.findElement(By.id("btnSearch")).click();

            await driver.wait(until.elementLocated(By.id("btnCsvButton")), 5000);
            await driver.findElement(By.id("btnCsvButton")).click();
        } catch (error) {
            console.log("restarting");
            await driver.quit();
            return pull(DocType, RecordDateFrom, RecordDateTo);
        }

        while (!fs.existsSync(path)) { await driver.sleep(1); }
        fs.rename(path, newPath, (err) => {
            if (err) { console.error('Error renaming file:', err); return; }
            console.log(`New Path: "${newPath}"`);
            path = newPath;
        });
    } else { 
        path = newPath;
        index = parseInt(await getLastRecordIndex(getID(DocType))) + 1 || 0;
    }

    let nameindex = (DocType === "LIENS" || DocType === "LIS PENDENS") ? 1 : 0;
    let peopleSet = new Set(fs.readFileSync(path, 'utf8').trimEnd().split("\n").map((item) => { return item.split(',')[nameindex].trim().replaceAll("\"", ""); }));

    for (let name of peopleSet) {
        if (name.split(" ").length <= 1) continue;
        
        let namelist = name.split(" ");
        if (namelist.length > 3 && !(namelist.includes("JR") || namelist.includes("SR") || namelist.includes("TRE")) || ["LLC", "INC", "TRUSTEE"].includes(namelist[namelist.length - 1])) continue;

        await driver.get(`https://www.pcpao.gov/quick-search?qu=1&input=${name.split(" ")[0]},%20${name.split(" ")[1]}&search_option=owner`);

        let properties = [];
        for (let row of (await driver.findElements(By.css("tr[role=row]")))) {
            let data = await row.findElements(By.css("td"));
            if (data.length > 1 && ["0000", "0090", "0110", "0310", "0311", "0810", "0820", "0822", "1000", "1032", "1090", "1120", "1135", "1423", "2226", "2816", "3912", "3913", "4000", "4090"].includes((await data.at(5).getText()).trim().split(" ")[0])) properties.push(await data.at(2).getText());
        }
        
        await driver.sleep(1);
        for (let p of properties) { index = await openLink(driver, p.split("-"), index, name, namelist, DocType); }
    }
    await driver.quit();
}

async function openLink(driver, id, index, name, namelist, DocType) {
    let link = `https://www.pcpao.gov/property-details?s=${id[2] + id[1] + id[0] + id[3] + id[4] + id[5]}`;
    await driver.get(link);

    if ((await driver.findElement(By.css("body"))).getText() === "504 Gateway Time-out") return await openLink(driver, id, index, name, namelist, DocType);

    let record = [ index, name, namelist.slice(1).join(" "), namelist.at(0), await driver.findElement(By.id("property_use")).getText() ];
    index++;

    let mailling_add = (await driver.findElement(By.id("mailling_add")).getText()).split("\n");
    record.push(mailling_add[0]);
    record.push(mailling_add.slice(1).join(" ").split(", ")[0]);
    record.push(mailling_add.slice(1).join(" ").split(", ")[1].split(" ")[0]);
    record.push(mailling_add.slice(1).join(" ").split(", ")[1].split(" ")[1]);
            
    let site_address = (await driver.findElement(By.id("site_address")).getText()).split("\n");
    record.push(site_address[0]);
    record.push(site_address.slice(1).join(" ").split(", ")[0]);
    record.push(site_address.slice(1).join(" ").split(", ")[1].split(" ")[0]);
    record.push(site_address.slice(1).join(" ").split(", ")[1].split(" ")[1]);
            
    record.push((await driver.findElement(By.id("first_second_owner")).getText()).split("\n")[1]);
    if (record.at(record.length - 1) === undefined) record[record.length - 1]  = "";
    record.push(link);
    await writeRecord(getID(DocType), record);
    return index;
}

async function pullProbates(RecordDateFrom, RecordDateTo) {
    const options = new Chrome.Options()
        .excludeSwitches('enable-logging')
        .addArguments("--disable-extensions", "--disable-dev-shm-usage", "--no-sandbox")
        .setPageLoadStrategy("eager")
        .setUserPreferences({
            "download.default_directory": `${__dirname}\\csv\\`,
            "download.prompt_for_download": false
        });

    let driver = await new Builder().forBrowser(Browser.CHROME).setChromeOptions(options).build();
    await driver.get("https://courtrecords.mypinellasclerk.gov/");

    await driver.findElement(By.css("#categoryPicker > div > div > button")).click();
    await driver.findElement(By.css("#categoryPicker > div > div > ul > li.multiselect-item.multiselect-all.active > a > label")).click();
    await driver.findElement(By.css("#categoryPicker > div > div > ul > li:nth-child(18) > a > label")).click();
    await driver.findElement(By.css("#categoryPicker > div > div > button")).click();

    await driver.sleep(100);
    await driver.executeScript(`document.getElementById('DateTo').value='${RecordDateTo}'`);
    await driver.sleep(100);
    await driver.executeScript(`document.getElementById('DateFrom').value='${RecordDateFrom}'`);

    await driver.findElement(By.id("caseSearch")).click();

    let index = 0;
    await driver.wait(until.elementLocated(By.css("#caseList")), 1000000);
    let len = parseInt((await driver.findElement(By.css("#main > div:nth-child(10) > div > div.card-header > div > div.col-sm-8.col-md-8.search-bar-results")).getText()).split(" ")[2]);
    let people = [];

    console.log(len);

    while (index < len) {
        await driver.wait(until.elementLocated(By.css("#caseList_length > label > select")), 20000);
        await driver.findElement(By.css("#caseList_length > label > select")).click();
        await driver.findElement(By.css("#caseList_length > label > select > option:nth-child(5)")).click();
        await driver.findElement(By.css("#caseList_length > label > select")).click();
        await driver.sleep(10);
        index++;

        let name = (await driver.findElement(By.css(`#caseList > tbody > tr:nth-child(${index}) > td:nth-child(4)`)).getText()).split(":")[1];
        if (name === undefined || people.map((person) => person[0]).includes(name) || name.replace("THE ESTATE OF", "") === name) continue;
        
        name = name.replace("THE ESTATE OF", "").trim();

        await driver.findElement(By.css(`#caseList > tbody > tr:nth-child(${index}) > td.colCaseNumber > a`)).click();
        let beneficiary = await driver.findElement(By.css("#partiesCollapse > div > div > table > tbody > tr:nth-child(2) > td:nth-child(1) > span")).getText();
        let attorney = "";
        try { attorney = await driver.findElement(By.css("#partiesCollapse > div > div > table > tbody > tr:nth-child(2) > td:nth-child(3)")).getText(); }
        catch (e) { attorney = ""; }
        await driver.findElement(By.css("#caseDetails > div.card-header > div > div.col-sm-2.col-md-2.search-bar-refine > a.pull-left.print-icon.print-icon-text")).click();
        people.push([name, beneficiary, attorney]);
    }
    
    for (let person of people) {
        let name = person[0]
        if (name.split(" ").length <= 1) continue;
        
        let namelist = name.replace("SR", "").replace("JR", "").trim().split(" ");
        if (namelist.length > 3 && !namelist.includes("TRE") || ["LLC", "INC", "TRUSTEE"].includes(namelist[namelist.length - 1])) continue;

        let records = await searchName(driver, namelist);
        if (records === undefined || records.length === 0) continue;

        let last = [];
        for (let record of records) {
            if (last === undefined) continue;
            else if (last.filter(a => parseInt(a[2]) < parseInt(record[2])).length == 0) last = [record];
            else if (last.filter(a => parseInt(a[2]) === parseInt(record[2])).length != 0) last.push(record);
        }

        last = last.map(record => [person[0]].concat(record.concat([person[1], person[2]])));

        if (person[2] === "") {
            for (let rec of last) writeRecord(getID("PROBATE DOCUMENT"), rec);
            continue;
        }
        
        let attorney = person[2].replace("SR", "").replace("JR", "").replace("ESQ", "").trim().split(" ");
        
        await driver.get(`https://www.floridabar.org/directories/find-mbr/?lName=${attorney[attorney.length - 1]}&fName=${attorney[0]}&sdx=N&eligible=Y&deceased=N&pageNumber=1&pageSize=100`)
        
        let result = (await driver.findElements(By.css("#output > .section-body"))).at(0);
        if (result === undefined) {
            for (let rec of last) writeRecord(getID("PROBATE DOCUMENT"), rec);
            continue;
        }
        let attorney_info = [];
        attorney_info.push((await result.findElement(By.css(".profile-bar-number")).getText()).substring(5));
        
        let long_text = (await result.findElement(By.css("div.profile-contact > p:nth-child(1)")).getText()).split("\n");
        attorney_info.push(long_text[0]);
        attorney_info.push(long_text.splice(long_text.length - 2).join(" "));
        
        long_text = (await result.findElement(By.css("div.profile-contact > p:nth-child(2)")).getText()).split("\n");
        attorney_info.push(long_text[0].includes("Office:") ? long_text[0].substring(8) : "");
        attorney_info.push(long_text[1].includes("Cell:")   ? long_text[0].substring(8) : "");
        try { attorney_info.push(await result.findElement(By.css("div.profile-contact > p:nth-child(2) .icon-email")).getText()); }
        catch (e) { attorney_info.push(" "); }

        for (let rec of last.map(record => record.concat(attorney_info))) writeRecord(getID("PROBATE DOCUMENT"), rec);
    }
    driver.quit();
}

async function searchName(driver, name) {
    await driver.get(`https://www.pcpao.gov/quick-search?qu=1&input=${name[name.length - 1]},%20${name.slice(0, name.length - 1).join(" ")}&search_option=owner`);
    try { await driver.wait(until.elementLocated(By.css("#quickSearch > tbody > tr")), 20000); }
    catch (e) { return await searchName(driver, name) }
    const rows = await driver.findElements(By.css("#quickSearch > tbody > tr"));
    
    if (rows.length === 1 && (await rows.at(0).findElements(By.className("dataTables_empty"))).length > 0) return name.length > 2 ? await searchName(driver, [name[0], name[name.length - 1]]) : undefined;
    
    let estates = [];
    for (const row of await rows) { if ((await (await row.findElements(By.css("td"))).at(1).getText()).includes("EST")) estates.push(row); }
    if (estates.length != 0) console.log(`FOUND EST FOR: ${name.join(" ")}`);
    estates = estates.length != 0 ? estates : rows;

    let properties = [];
    for (const estate of await estates) {
        let td = await estate.findElements(By.css("td"));
        let values = [(await td.at(5).getText()).split(" ")[0], (await td.at(2).getText()).split("-")];
        if (["0000", "0090", "0110", "0310", "0311", "0810", "0820", "0822", "1000", "1032", "1090", "1120", "1135", "1423", "2226", "2816", "3912", "3913", "4000", "4090"].includes(await values.at(0))) properties.push(values);
    }

    let parcels = [];
    for (const value of properties) parcels.push(await searchProperty(driver, [name[name.length - 1], name.slice(0, name.length - 1).join(" ")], value));
    return parcels;
}

async function searchProperty(driver, name, value) {
    let parcel = value.at(1);
    let link = `https://www.pcpao.gov/property-details?s=${parcel[2] + parcel[1] + parcel[0] + parcel.slice(3).join("")}`;
    let record = [value.at(0), link];

    await driver.get(link);
    if ((await driver.findElement(By.css("body"))).getText() === "504 Gateway Time-out") return await searchProperty(driver, name, value);

    let homesteads = (await driver.findElements(By.css("#tblExemptions > tbody > tr"))).filter(async row => await row.getAttribute("bg-color") === null);
    let last;
    let index = 0;
    while (last === undefined && index < homesteads.length) {
        if (await homesteads[index].getAttribute("bg-color") != "#ff4747") last = await homesteads[index].findElement(By.className("sorting_1")).getText();
        index++;
    }
    record.push(last);
    record = record.concat(name[name.length - 1], name.slice(0, name.length - 1));
    
    record.push((await driver.findElement(By.id("mailling_add")).getText()).replace("(Unincorporated)", "").trim());
    try {
        let mailling_add = record.at(5).split("\n").slice(1).join(" ").split(", ");
        record.push(mailling_add[0]);
        record = record.concat(mailling_add[1].trim().split(" "));
    } catch (e) { record = record.concat(["", "", "", ""]); }

    record.push((await driver.findElement(By.id("site_address")).getText()).replace("(Unincorporated)", "").trim());
    try {
        let site_address = record.at(9).split("\n").slice(1).join(" ").split(", ");
        record.push(site_address[0]);
        record = record.concat(site_address[1].trim().split(" "));
    } catch (e) { record = record.concat(["", "", "", ""]); }

    record.push((await driver.findElement(By.id("first_second_owner")).getText()).trim().split("\n")[1]);
    if (record.at(record.length - 1) === undefined) record[record.length - 1]  = "";
    return record;
}

async function run() {
    range = 'december';

    await pullProbates("04/01/2025", "04/07/2025");
    //await pullProbates("04/08/2025", "04/14/2025");
    //await pullProbates("04/15/2025", "04/21/2025");
    //await pullProbates("05/1/2025", "05/07/2025");
    //await pull("PROBATE DOCUMENT",          "03/1/2025", "03/31/2025");
    //await pull("LIENS",                     "03/1/2025", "03/15/2025");
    //await pull("LIS PENDENS",               "03/1/2025", "03/31/2025");
    //await pull("NOTICE OF CONTEST OF LIEN", "03/1/2025", "03/31/2025");
}

run();