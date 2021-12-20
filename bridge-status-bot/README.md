# bridge-status-bot

## Run

The usage like:

```
$ ./app.sh "<ETHERSCAN_API_KEY>" "<SLACK_BOT_TOKEN>" "<SLACK_CHANNEL>"
```

You can get Slack bot token from Slack settings and you can get Etherescan API key from [Etherscan APIs](https://etherscan.io/apis).

## Actual Code is deployed in k8s-config with crontab and parameters
https://github.com/planetarium/k8s-config/blob/main/9c-main/bridge-status-bot.yaml
