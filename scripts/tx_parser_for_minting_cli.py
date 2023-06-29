from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
import json

# Tested with Chrome Version 114.0.5735.198 (Official Build) (arm64)

# Set the path to the Chromium WebDriver executable
webdriver_path = '/Users/admin/Downloads/chromedriver'

# Configure the Chromium options
chrome_options = webdriver.ChromeOptions()
chrome_options.add_argument('--headless')  # Run in headless mode without opening a browser window

s = Service(webdriver_path)
driver = webdriver.Chrome(service=s, options=chrome_options)

print('9c-scan TX URL:')
url = input()
if not url[:22] == 'https://9cscan.com/tx/':
    print('URL should start with https://9cscan.com/tx/...')
    exit(1)

# Navigate to the desired URL
print("Loading...")
driver.get(url)
print("")

# NCG Transfer Requested Amount
ncg_transfer_amount = driver.find_element(By.XPATH, '/html/body/div/div/div[3]/div/div[2]/div[2]/div[4]/div[2]')

# 100 == 1.00 NCG, 41630 == 416.30 NCG, 500000 = 5000.00 NCG
parsed_data = json.loads(ncg_transfer_amount.text.strip())
amount = int(parsed_data[1])
fee = 1000 # 10.00 fixed NCG when requested amount is less than 1000.00 NCG
if amount > 100000: # > 1000.00 NCG
    fee = amount * 0.01
fee = int(fee)
final_amount = int(amount - fee)
final_amount_str = str(final_amount)[0:-2] + '.' + str(final_amount)[-2:]
print("NCG Requested:", amount, "/ Fee:", fee, "/ Final:", final_amount)

# Sender
sender = driver.find_element(By.XPATH, '/html/body/div/div/div[3]/div/div[2]/div[2]/div[7]/div[2]')
sender = sender.text.strip()
print("Sender (9c):", sender)

# Memo
memo = driver.find_element(By.XPATH, '/html/body/div/div/div[3]/div/div[2]/div[2]/div[5]/div[2]')
memo = memo.text.strip()
print("Recipient (ETH):", memo)
print("")

# Bridge CLI CMD
print(">> npm run mint", memo, final_amount_str)

# Close the browser
driver.quit()
