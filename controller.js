const axios = require("axios");
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const { MongoClient } = require('mongodb');
const logger = require('./logger');
require('dotenv').config();

let client;

async function connectToMongoDB() {
    client = new MongoClient(process.env.MONGO_URL);
    await client.connect();
}

async function insertDataIntoMongoDB(dbName, collectionName, data) {
    try {
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Simply insert the data without adding _id manually
        await collection.insertMany(data);

        console.log(`${data.length} objects inserted into MongoDB successfully.`);
    } catch (err) {
        logger.error(`Error inserting data into MongoDB: ${err.message}`);
        console.error('Error inserting data into MongoDB:', err);
    }
}

async function getDataFromMongoDB(dbName, collectionName, today) {
    try {
        const db = client.db(dbName);
        const collection = db.collection(collectionName);

        // Query MongoDB to get data based on publié_le key for today's date
        const data = await collection.find({ publié_le: today }).toArray();
        return data;
    } catch (err) {
        console.error('Error fetching data from MongoDB:', err);
        return [];
    }
}

const getMarcheList = async (req, res) => {
    console.log("Starting Puppeteer...");
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    console.log("Puppeteer launched, navigating to search URL...");

    try {
        await page.goto(process.env.SEARCH_URL);

        // Select procedure type
        await page.waitForSelector('#ctl0_CONTENU_PAGE_AdvancedSearch_procedureType');
        await page.select('#ctl0_CONTENU_PAGE_AdvancedSearch_procedureType', '1');

        // Clear start and end dates
        await page.waitForSelector('#ctl0_CONTENU_PAGE_AdvancedSearch_dateMiseEnLigneStart');
        await page.$eval('#ctl0_CONTENU_PAGE_AdvancedSearch_dateMiseEnLigneStart', el => el.value = '');

        await page.waitForSelector('#ctl0_CONTENU_PAGE_AdvancedSearch_dateMiseEnLigneEnd');
        await page.$eval('#ctl0_CONTENU_PAGE_AdvancedSearch_dateMiseEnLigneEnd', el => el.value = '');

        // Set today's date for dateMiseEnLigneCalcule
        const endDateValue = await page.$eval('#ctl0_CONTENU_PAGE_AdvancedSearch_dateMiseEnLigneCalculeEnd', el => el.value);
        await page.$eval('#ctl0_CONTENU_PAGE_AdvancedSearch_dateMiseEnLigneCalculeStart', (el, value) => el.value = value, endDateValue);

        // Start search
        await page.waitForSelector('#ctl0_CONTENU_PAGE_AdvancedSearch_lancerRecherche');
        await page.click('#ctl0_CONTENU_PAGE_AdvancedSearch_lancerRecherche');
        await page.waitForNavigation();

        // Set items per page to 50
        const selectorExists = await page.$('#ctl0_CONTENU_PAGE_resultSearch_listePageSizeTop') !== null;
        if (selectorExists) {
            await page.select('#ctl0_CONTENU_PAGE_resultSearch_listePageSizeTop', '50');
            await page.waitForNavigation();
        } else {
            console.log('No data available to scrape.');
            res.send('No data available to scrape.');
            return;
        }

        const htmlContent = await page.content();
        const $ = cheerio.load(htmlContent);
        const trs = $('tbody tr');

        const promises = await getTableRowsFields(trs, $);

        const today = new Date();

        // Get data from MongoDB based on publié_le key for today's date
        await connectToMongoDB();
        const mongoData = await getDataFromMongoDB(process.env.MONGO_DB_NAME, process.env.COLLECTION_NAME, formatDate(today));

        // Filter out data from today to avoid duplicates
        const todayData = promises.filter(item => item && !mongoData.find(mongoItem =>
            item?.publié_le === mongoItem?.publié_le &&
            item?.categorie === mongoItem?.categorie &&
            item?.procédure === mongoItem?.procédure &&
            item?.link === mongoItem?.link &&
            item?.Lieu_dexécution === mongoItem?.Lieu_dexécution &&
            item?.Acheteur_public === mongoItem?.Acheteur_public &&
            item?.Telechargement === mongoItem?.Telechargement &&
            item?.objet === mongoItem?.objet &&
            item?.reference === mongoItem?.reference &&
            item?.date_de_fin_daffichage === mongoItem?.date_de_fin_daffichage
        ));

        const currentDate = new Date();
        const formattedTime = currentDate.toLocaleTimeString('fr-FR');

        console.log(`Time: ${formattedTime}`);
        console.log(`Today's objects: ${todayData.length}`);

        if (todayData.length > 0) {
            await insertDataIntoMongoDB(process.env.MONGO_DB_NAME, process.env.COLLECTION_NAME, todayData);
        } else {
            console.log('No new objects to insert.');
        }

        res.send(`Scraper finished. Inserted ${todayData.length} new records.`);
    } catch (err) {
        console.log("Error: " + err);
        logger.error(`Scraping error: ${err.message}`);
        res.status(500).send("Error occurred during scraping.");
    } finally {
        await browser.close();

        if (client) {
            await client.close();
        }
    }
};

function deformatDate(date) {
    // Split the date string into day, month, and year
    const [day, month, year] = date.split('/');
    return new Date(`${year}-${month}-${day}`);
}

function formatDate(date) {
    const d = new Date(date);
    let day = ('0' + d.getDate()).slice(-2);
    let month = ('0' + (d.getMonth() + 1)).slice(-2);
    let year = d.getFullYear();
    return `${day}/${month}/${year}`;
}

const getMarcheDetais = async (url) => {
    const res = await axios.get(url);
    const $ = cheerio.load(res.data);
    const date_de_fin_daffichage = $("#ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary_dateHeureLimiteRemisePlis").text() || 'None';
    const reference = $("#ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary_reference").text() || 'None';
    const objet = $('#ctl0_CONTENU_PAGE_idEntrepriseConsultationSummary_objet').text() || 'None';
    const Telechargement = $("#ctl0_CONTENU_PAGE_panelOnglet1 > div.content > div:nth-child(1) > div.content > div:nth-child(2) > div.content > div.bloc-docs-link.bloc-250 > ul > li:nth-child(1) > a").attr('href') || 'None';
    return {
        Telechargement: url,
        objet, reference, date_de_fin_daffichage, verify: false
    }
}

const getTableRowsFields = async (rows, $) => {
    const today_date = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

    const infos = rows.map(async function () {
        const publié_le = $(this).find('td:nth-child(2) > div:nth-child(4)').text().trim();
        const format = deformatDate(publié_le);
        const publié = new Date(format.getFullYear(), format.getMonth(), format.getDate());
        if (!isNaN(publié.getTime()) && publié.getTime() === today_date.getTime()) {
            const categorie = $(this).find('td:nth-child(2) > div:nth-child(3)').text().trim();
            const procédure = $(this).find('.line-info-bulle').clone().children().remove().end().text().trim();
            const Acheteur_public = $(this).find('td:nth-child(3) div div.objet-line').last().text().trim().replace(/\s+/g, ' ').replace('Acheteur public :', '');
            const Lieu_dexécution = $(this).find('#' + $(this).find('td:nth-child(4) div div div div').attr('id')).text().trim().replace(/\s+/g, ' ')
            const link = $(this).find('td:nth-child(6) a').attr('href');
            let obj = {};
            if (link) {
                obj = await getMarcheDetais(process.env.DEMAIN_NAME + link);
            }
            return { publié_le, categorie, procédure, Acheteur_public, Lieu_dexécution, ...obj }
        }
        return null;
    }).get();

    return await Promise.all(infos.filter(item => item != null));
}

module.exports = {
    ScrapOffres: getMarcheList
};
