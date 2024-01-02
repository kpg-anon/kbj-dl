#!/usr/bin/env node

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

puppeteer.use(StealthPlugin());

async function fetchM3u8URL(url, prefix) {
    return new Promise(async (resolve, reject) => {
        console.log(`${prefix}: Launching browser...`);
        const browser = await puppeteer.launch({
            headless: "new", 
            args: ['--disable-notifications']
        });
        const page = await browser.newPage();

        let foundM3U8 = false;

        await page.setRequestInterception(true);
        page.on('request', interceptedRequest => {
            if (foundM3U8) {
                interceptedRequest.abort();
                return;
            }

            const requestUrl = interceptedRequest.url();
            if (requestUrl.includes('.m3u8')) {
                console.log('Found .m3u8 URL:', requestUrl);
                foundM3U8 = true;

                const outputFilenameBase = getOutputFilename(url);
                const outputFilename = outputFilenameBase + '.mp4';
                const outputDir = createDirectoryAndGetPath(outputFilenameBase);
                fs.writeFileSync(path.join(outputDir, 'list.txt'), requestUrl);

                downloadVideo(outputDir, outputFilename)
                    .then(() => {
                        browser.close();
                        resolve();
                    })
                    .catch(err => {
                        console.error(err);
                        reject(err);
                    });

                interceptedRequest.abort();
            } else {
                interceptedRequest.continue();
            }
        });

        console.log(`${prefix}: Navigating to URL: ${url}`);
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        console.log('Extracting embed URL from iframe...');
        const embedUrl = await page.evaluate(() => {
            const iframe = document.querySelector('.responsive-player iframe');
            return iframe ? iframe.src : null;
        });

        if (!embedUrl) {
            console.error('Embed URL not found');
            await browser.close();
            reject('Embed URL not found');
            return;
        }

        console.log('Navigating to embed URL:', embedUrl);
        await page.goto(embedUrl, { waitUntil: 'domcontentloaded' });
    });
}

function createDirectoryAndGetPath(dirName) {
    const outputDir = path.join(process.cwd(), dirName);
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir);
    }
    return outputDir;
}

function getOutputFilename(url) {
    url = url.trim();
    const regex = /.*_(\w+_\d+)\/?$/;
    const match = url.match(regex);
    return match ? match[1] : 'default_output';
}

function downloadVideo(outputDir, outputFilename) {
    return new Promise((resolve, reject) => {
        console.log(`Downloading file: ${outputFilename}`);
        const ytDlp = spawn('yt-dlp', ['-o', outputFilename, '-a', 'list.txt', '--downloader', 'ffmpeg'], { cwd: outputDir, shell: true });

        ytDlp.stdout.on('data', (data) => {
            process.stdout.write(data.toString());
        });

        ytDlp.stderr.on('data', (data) => {
            process.stderr.write(data.toString());
        });

        ytDlp.on('close', (code) => {
            if (code !== 0) {
                reject(`yt-dlp exited with code ${code}`);
            } else {
                try {
                    fs.unlinkSync(path.join(outputDir, 'list.txt'));
                } catch (err) {
                    console.error('Error deleting list.txt file:', err);
                }
                resolve();
            }
        });
    });
}

async function processUrls(urls) {
    for (let i = 0; i < urls.length; i++) {
        const url = urls[i];
        const prefix = `Download ${i + 1}/${urls.length}`;

        const outputFilenameBase = getOutputFilename(url);
        console.log(`${prefix}: Processing ${url}`);
        console.log(`${prefix}: Matched Filename: ${outputFilenameBase}`);

        try {
            await fetchM3u8URL(url, prefix);
            console.log(`${prefix}: Download complete.`);
        } catch (err) {
            console.error(`${prefix}: Error processing ${url}:`, err);
        }
    }
    console.log("All downloads complete.");
}

async function main() {
    const args = process.argv.slice(2);
    let urls = [];

    if (args.length === 0) {
        console.error('Please provide URLs or a file containing URLs.');
        process.exit(1);
    }

    if (args[0] === '-a' && args.length === 2) {
        urls = fs.readFileSync(args[1], 'utf-8').split('\n').filter(line => line.trim() !== '');
    } else {
        urls = args;
    }

    await processUrls(urls);
}

main().catch(console.error);