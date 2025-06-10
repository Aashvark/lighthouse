const { Builder, By, Key, until, util, Browser } = require("selenium-webdriver");
const Chrome = require("selenium-webdriver/chrome");
const fs = require("fs");
const path = require('path');
const process = require('process');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

async function writeRecord(record) {
    const auth = new google.auth.GoogleAuth({
      keyFile: CREDENTIALS_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const sheets = google.sheets({ version: 'v4', auth });

    const spreadsheetId = '1qDNSxv5jsZquCxeRneZQAz_wMT2a_oWAT4p2Kh9ALtc';
    const range = 'January';

    const request = {
      spreadsheetId: spreadsheetId,
      range: range,
      valueInputOption: 'USER_ENTERED',
      resource: { values: [record] },
    };
    const response = await sheets.spreadsheets.values.append(request);
}

async function pull(DocType, RecordDateFrom, RecordDateTo) {
    const options = new Chrome.Options()
        .excludeSwitches('enable-logging')
        .setPageLoadStrategy("eager")
        .setUserPreferences({
            "download.default_directory": `${__dirname}\\csv\\`,
            "download.prompt_for_download": false
        });

    let driver = await new Builder().forBrowser(Browser.CHROME).setChromeOptions(options).build();
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
        await driver.quit();
        return pull(DocType, RecordDateFrom, RecordDateTo);
    }

    let path = `${__dirname}\\csv\\SearchResults.csv`;
    let newPath = `${__dirname}\\csv\\${DocType.toLowerCase()}\\${RecordDateFrom.replaceAll("/", "-")}-${RecordDateTo.replaceAll("/", "-")}.csv`;
    while (!fs.existsSync(path)) { await driver.sleep(1); }
    fs.rename(path, newPath, (err) => {
        if (err) { console.error('Error renaming file:', err); return; }
        console.log(`New Path: "${newPath}"`);
        path = newPath;
    });

    let index = 0;
    for (let name of new Set(fs.readFileSync(path, 'utf8').trimEnd().split("\n").map((item) => { return item.split(',')[1].replaceAll("\"", ""); }))) {
        if (name == "IndirectName") continue;
        
        let namelist = name.split(" ");
        if (namelist.length > 3 && !(namelist.includes("JR") || namelist.includes("SR") || namelist.includes("TRE")) || ["LLC", "INC", "TRUSTEE"].includes(namelist[namelist.length - 1])) continue;

        await driver.get(`https://www.pcpao.gov/quick-search?qu=1&input=${name.split(" ")[0]},%20${name.split(" ")[1]}&search_option=owner`);

        let drive = await new Builder().forBrowser(Browser.CHROME).setChromeOptions(options).build();

        for (let row of (await driver.findElements(By.css("#quickSearch tbody tr")))) {
            let data = await row.findElements(By.css("td"));
            if (data.length === 1 || !(["0000", "0090", "0110", "0310", "0311", "0810", "0820", "0822", "1000", "1032", "1090", "1120", "1135", "1423", "2226", "2816", "3912", "3913", "4000", "4090"].includes((await data.at(5).getText()).split(" ")[0]))) continue;
            
            let id = (await data.at(2).getText()).split("-");
            let link = `https://www.pcpao.gov/property-details?s=${id[2] + id[1] + id[0] + id[3] + id[4] + id[5]}`;
            await drive.get(link);

            let record = [ index, name, namelist.slice(1).join(" "), namelist.at(0), await drive.findElement(By.id("property_use")).getText() ];
            index++;

            let mailling_add = (await drive.findElement(By.id("mailling_add")).getText()).split("\n");
            record.push(mailling_add[0]);
            record.push(mailling_add.slice(1).join(" ").split(", ")[0]);
            record.push(mailling_add.slice(1).join(" ").split(", ")[1].split(" ")[0]);
            record.push(mailling_add.slice(1).join(" ").split(", ")[1].split(" ")[1]);
            
            let site_address = (await drive.findElement(By.id("site_address")).getText()).split("\n");
            record.push(site_address[0]);
            record.push(site_address.slice(1).join(" ").split(", ")[0]);
            record.push(site_address.slice(1).join(" ").split(", ")[1].split(" ")[0]);
            record.push(site_address.slice(1).join(" ").split(", ")[1].split(" ")[1]);
            
            record.push((await drive.findElement(By.id("first_second_owner")).getText()).split("\n")[1]);
            if (record.at(record.length - 1) === undefined) record[record.length - 1]  = "";
            record.push(link);

            await writeRecord(record);
        }
        await drive.quit();
    }
    await driver.quit();
}

pull("LIENS", "01/01/2025", "01/08/2025");