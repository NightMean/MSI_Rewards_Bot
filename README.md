# MSI Rewards Daily Login Bot

A lightweight, Dockerized bot that automates daily logins to the [MSI Request Program](https://rewards.msi.com/) to claim daily reward points. It tracks your points and sends Discord notifications when milestones are reached.

## Disclaimer

This bot is for **educational purposes only**. I am not responsible for any banned accounts, lost points, or other penalties incurred from using this tool.
Automating actions on rewards.msi.com may violate their Terms of Service. Use at your own risk.

## Features

-  **Automated Daily Login**: Runs automatically every day (default 18:30) - configurable
-  **Discord Notifications**: Sends rich embed notifications when you reach configured milestones or if the bot fails (e.g. invalid cookies, site changes)

## Prerequisites

- **Docker** and **Docker Compose** installed
- **Cookies**: You must extract your `msi_members_center_session` cookie from your browser
- **Discord Webhook**: A webhook URL for a Discord channel

## Quick Start (Docker Hub)

1.  **Create a folder** for the bot.
2.  **Create `docker-compose.yml`**:
    ```yaml
    services:
      msi-bot:
        image: nightmean/msi-reward-bot:latest
        container_name: msi_reward_bot
        restart: unless-stopped
        volumes:
          - ./data:/app/data
          - ./screenshots:/app/screenshots
        env_file:
          - .env
    ```
3.  **Configure**:
    *   Rename `.env.example` to `.env` and configure it (see below for options)
    *   **Export Cookies**:
        *   Log in to [rewards.msi.com](https://rewards.msi.com/)
        *   Use a browser extension like [Cookie-Editor](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm) to export cookies as JSON
        *   Save them to `data/cookies.json` folder in the project root
        > **Note**: If you log in again manually in your browser, the cookies will be invalidated. You must re-export them and update `data/cookies.json`.
4.  **Run**:
    ```bash
    docker-compose up -d
    ```

## Configuration

### Environment Variables (.env)

| Variable | Description | Default | Required |
| :--- | :--- | :--- | :--- |
| `DISCORD_WEBHOOK_URL` | Your Discord Webhook URL for notifications | None | **Yes** |
| `DISCORD_USERNAME` | Custom name for the bot in Discord messages | MSI Rewards Daily Login Bot | No |
| `MILESTONES` | Comma-separated points milestones to track | 400,500,600 | No |
| `CRON_SCHEDULE` | Cron expression for when the bot runs | `30 18 * * *` (18:30) | No |
| `TZ` | Timezone for the cron schedule and logs | `Europe/Bratislava` | No |
| `NAVIGATION_TIMEOUT` | Timeout in ms for page loads. Increase if getting timeouts. | `60000` (60s) | No |
| `SAVE_SCREENSHOTS` | Save debug screenshots to `screenshots/` folder | `false` | No |

## Build from Source

1.  **Clone the repository**.
2.  **Configure** `.env` and `data/Cookies.json`.
3.  **Run**:
    ```bash
    docker-compose up -d --build
    ```

## Troubleshooting

- **403 Access Denied**: The bot tries to handle this by using a Desktop User-Agent. If it fails, check logs for error messages and look in the `screenshots/` folder for `debug_error.png`.
- **Navigation Timeout**: If you see "Navigation timeout of X ms exceeded", your connection might be slow or the server overloaded. Increase `NAVIGATION_TIMEOUT` in `.env` (e.g. `120000` for 2 minutes).

## Donations
To support me you can use link below:

<a href="https://www.buymeacoffee.com/nightmean" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" style="width: 200px !important;" ></a>

# License

This project is licensed under the [GNU General Public License Version 3](https://www.gnu.org/licenses/gpl-3.0.html). For details, see [LICENSE](LICENSE)
