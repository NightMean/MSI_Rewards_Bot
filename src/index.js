const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer-core');
const axios = require('axios');
const cron = require('node-cron');
require('dotenv').config();

// Configuration
const COOKIES_PATH = process.env.COOKIES_PATH || './data/cookies.json';
const STATE_PATH = process.env.STATE_PATH || './data/state.json';
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR || './screenshots';
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '30 18 * * *';
const MILESTONES = (process.env.MILESTONES || '400,500,600').split(',').map(Number);
const TIMEZONE = process.env.TZ || 'Europe/Bratislava';
const SAVE_SCREENSHOTS = process.env.SAVE_SCREENSHOTS === 'true';
const DISCORD_USERNAME = process.env.DISCORD_USERNAME || 'MSI Rewards Daily Login Bot';
const POINTS_SELECTOR = '.kv__memberbox--info li:nth-child(2)';

// Ensure directories exist
if (!fs.existsSync(path.dirname(STATE_PATH))) fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
if (SAVE_SCREENSHOTS && !fs.existsSync(SCREENSHOT_DIR)) fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

const log = (msg) => console.log(`[${new Date().toLocaleString('sk-SK', { timeZone: TIMEZONE })}] ${msg}`);

async function sendDiscordNotification(type, data) {
    if (!DISCORD_WEBHOOK_URL) return;

    const embed = {
        title: "MSI Reward Program",
        url: "https://rewards.msi.com/",
        timestamp: new Date().toISOString()
    };

    if (type === 'milestone') {
        embed.color = 5763719; // Green (0x57F287)
        embed.description = `🎉 **Milestone Reached!**\n\nCurrent Points: **${data.points}**\nMilestone Passed: **${data.milestone}**`;
    } else if (type === 'error') {
        embed.color = 15548997; // Red (0xED4245)
        embed.description = `❌ **Error Occurred**\n\n${data.message}`;
    }

    try {
        await axios.post(DISCORD_WEBHOOK_URL, {
            username: DISCORD_USERNAME,
            embeds: [embed]
        });
        log(`Sent Discord notification (${type})`);
    } catch (error) {
        log(`Failed to send Discord notification: ${error.message}`);
    }
}

async function runBot() {
    log('Starting bot run...');
    let browser;
    try {
        browser = await puppeteer.launch({
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium-browser',
            headless: 'new',
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu'
            ]
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

        // Load Cookies
        if (fs.existsSync(COOKIES_PATH)) {
            const fileStats = fs.statSync(COOKIES_PATH);
            if (fileStats.size === 0) {
                throw new Error('cookies.json is empty. Please export cookies and save them to this file.');
            }

            try {
                const cookiesString = fs.readFileSync(COOKIES_PATH, 'utf8');
                const cookies = JSON.parse(cookiesString);
                await page.setCookie(...cookies);
                log('Cookies loaded.');
            } catch (e) {
                if (e instanceof SyntaxError) {
                    throw new Error(`Invalid JSON in cookies.json: ${e.message}`);
                }
                throw e;
            }
        } else {
            throw new Error(`cookies.json not found at ${COOKIES_PATH}`);
        }

        // Navigate
        await page.goto('https://rewards.msi.com/', { waitUntil: 'networkidle2' });
        log('Page loaded.');

        // Scroll to top (User reported auto-scroll might hide points)
        await page.evaluate(() => window.scrollTo(0, 0));
        await new Promise(r => setTimeout(r, 1000)); // Short wait for scroll

        // Take debug screenshot (if enabled)
        if (SAVE_SCREENSHOTS) {
            await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'latest_run.png') });
        }

        // Extract points using exact selector
        // Selector found: .kv__memberbox--info li:nth-child(2)
        const pointsElementIdentifier = POINTS_SELECTOR;

        // Wait for the element to appear (timeout 5s to be safe, though networkidle2 should suffice)
        try {
            await page.waitForSelector(pointsElementIdentifier, { timeout: 5000 });
        } catch (e) {
            log('WARNING: Points element not immediately found.');
        }

        const pointsText = await page.evaluate((selector) => {
            const el = document.querySelector(selector);
            return el ? el.textContent.trim() : null;
        }, pointsElementIdentifier);

        if (!pointsText) {
            log('ERROR: Could not find points element (.kv__memberbox--info li:nth-child(2)). User might not be logged in.');
            await sendDiscordNotification('error', { message: "Could not find points element. Check if cookies are valid or site layout changed." });

            if (SAVE_SCREENSHOTS) {
                const html = await page.content();
                fs.writeFileSync(path.join(SCREENSHOT_DIR, 'debug_error.html'), html);
                await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'debug_error.png') });
            }
            return;
        }

        // Parse number from strings like "My Points: 1,200 Points"
        // 1. Match the first sequence of digits/commas/dots
        const match = pointsText.match(/([\d,.]+)/);

        if (!match) {
            log(`ERROR: Could not parse points from text: "${pointsText}"`);
            return;
        }

        // 2. Remove non-digits from that specific sequence (to handle 1,200 -> 1200)
        const cleanPoints = match[1].replace(/\D/g, '');
        const currentPoints = parseInt(cleanPoints, 10);

        if (isNaN(currentPoints)) {
            log(`ERROR: Could not parse points from text: "${pointsText}"`);
            return;
        }
        log(`Current Points: ${currentPoints}`);

        // State Management & Notifications
        let state = {};
        if (fs.existsSync(STATE_PATH)) {
            state = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        }

        const lastPoints = state.lastPoints || 0;

        // Check Milestones
        // We notify if we crossed a milestone boundary since the last run
        // i.e., lastPoints < Milestone <= currentPoints
        // OR if it's the first run (lastPoints=0) and we are above a milestone? 
        // User said "upon reaching". If I start at 393 and want 600, I shouldn't notify for 100/200/300.
        // So I only notify if lastPoints < M <= currentPoints.

        for (const milestone of MILESTONES) {
            // Notify if we crossed the milestone (or if it's the first run and we met it)
            if (lastPoints < milestone && currentPoints >= milestone) {
                await sendDiscordNotification('milestone', { points: currentPoints, milestone: milestone });
            }
        }

        // Update state
        state.lastPoints = currentPoints;
        state.lastRun = new Date().toISOString();
        fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));

        return { success: true };

    } catch (error) {
        log(`ERROR: ${error.message}`);
        await sendDiscordNotification('error', { message: error.message });
        if (browser) await browser.close(); // Safety close
        return { success: false, error: error.message };
    } finally {
        if (browser) await browser.close();
        log('Run complete.');
    }
}

// Single run argument
if (process.argv.includes('--run-once')) {
    runBot();
} else {
    // Cron Mode
    log(`Initializing Bot. Running initial check...`);

    // Run immediately on startup
    runBot().then((result) => {
        if (result.success) {
            log(`Initial check complete. Next run scheduled for: ${CRON_SCHEDULE} (TZ: ${TIMEZONE})`);
            cron.schedule(CRON_SCHEDULE, () => {
                runBot();
            }, {
                scheduled: true,
                timezone: TIMEZONE
            });
        } else {
            log(`CRITICAL: Initial run failed: "${result.error}". Entering dormant mode to prevent restart loop. Please fix the error and restart the container.`);
            // Keep process alive but do nothing, to prevent Docker restart loop spamming notifications
            setInterval(() => { }, 1000 * 60 * 60 * 24);
        }
    });
}
