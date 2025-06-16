const { Builder, By, until, Browser } = require("selenium-webdriver");
const Chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const path = require('path');
const process = require('process');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(process.cwd(), 'json/credentials.json');
const range = 'June';

async function writeRecord(id, record) {
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const response = google.sheets({ version: 'v4', auth }).spreadsheets.values.append({
      spreadsheetId: id,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [record] },
    });
}

async function getLastRecordIndex(id) {
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const response = await google.sheets({ version: 'v4', auth }).spreadsheets.values.get({
      spreadsheetId: id,
      range: range,
    });
    return await response.data.values[response.data.values.length - 1][0];
}

function getID(DocType) {
    if      (DocType === "PROBATE DOCUMENT")          return '1uEUNpoqq5v4CcfQOYx3ECa6ems2n6CUk20oShefmj2w';
    else if (DocType === "LIENS")                     return '187HiafgDVlCLFQaZ0dWZB_5NrA4m9tQeYBAThxd78ZI';
    else if (DocType === "LIS PENDENS")               return '18eUPlKCP5l7FBLcphnHrvwvFsSxgBuon3-3p841aGr4';
    else if (DocType === "NOTICE OF CONTEST OF LIEN") return '1JnSkBDGDPs2fZCAcWcQ7zYreOFwTuIY0GrJbduV_p94';
}

async function pull(DocType, RecordDateFrom, RecordDateTo) {
    const options = new Chrome.Options()
        .excludeSwitches('enable-logging')
        .addArguments("--profile-directory=Default", "--disable-extensions", "--disable-dev-shm-usage", "--no-sandbox")
        .setPageLoadStrategy("eager")
        .setUserPreferences({
            "download.default_directory": `${__dirname}\\csv\\`,
            "download.prompt_for_download": false
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

            await driver.findElement(By.id("btnSearch")).submit();

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
        index = parseInt(await getLastRecordIndex(getID(DocType))) + 1;
    }

    let nameindex = (DocType === "LIENS" || DocType === "LIS PENDENS") ? 1 : 0;
    let peopleSet = new Set(fs.readFileSync(path, 'utf8').trimEnd().split("\n").map((item) => { return item.split(',')[nameindex].replaceAll("\"", ""); }));

    for (let name of peopleSet) {
        if (name.split(" ").length <= 1) continue;
        
        let namelist = name.split(" ");
        if (namelist.length > 3 && !(namelist.includes("JR") || namelist.includes("SR") || namelist.includes("TRE")) || ["LLC", "INC", "TRUSTEE"].includes(namelist[namelist.length - 1])) continue;

        await driver.get(`https://www.pcpao.gov/quick-search?qu=1&input=${name.split(" ")[0]},%20${name.split(" ")[1]}&search_option=owner`);

        let properties = [];
        for (let row of (await driver.findElements(By.css("tr[role=row]")))) {
            let data = await row.findElements(By.css("td"));
            if (data.length > 1 && ["0000", "0090", "0110", "0310", "0311", "0810", "0820", "0822", "1000", "1032", "1090", "1120", "1135", "1423", "2226", "2816", "3912", "3913", "4000", "4090"].includes((await data.at(5).getText()).split(" ")[0])) properties.push(await data.at(2).getText())
        }
        
        await driver.sleep(1);
        for (let p of properties) {
            let id = p.split("-")
            let link = `https://www.pcpao.gov/property-details?s=${id[2] + id[1] + id[0] + id[3] + id[4] + id[5]}`;
            await driver.get(link);

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
        }
    }
    await driver.quit();
}

async function run() {
    await pull("PROBATE DOCUMENT",          "06/1/2025", "06/15/2025");
    await pull("LIENS",                     "06/1/2025", "06/15/2025");
    await pull("LIS PENDENS",               "06/1/2025", "06/15/2025");
    await pull("NOTICE OF CONTEST OF LIEN", "06/1/2025", "06/15/2025");
}

run();