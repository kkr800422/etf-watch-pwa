FUND_CATALOG = [
    {
        "id": "00981A",
        "name": "統一台股增長",
        "fund_code": "49YTW",
        "url": "https://www.ezmoney.com.tw/ETF/Fund/Info?FundCode=49YTW",
        "source": "EZMoney"
    },
    {
        "id": "00400A",
        "name": "國泰台股動能高息",
        "fund_code": "00400A.TW",
        "url": "https://www.cathaysite.com.tw/ETF/detail/EEA?tab=etf3",
        "source": "MoneyDJ"
    },
    {
        "id": "00991A",
        "name": "復華台灣未來50",
        "fund_code": "ETF23",
        "url": "https://www.fhtrust.com.tw/ETF/etf_detail/ETF23#stockhold",
        "source": "FH API"
    }
]

FUND_INDEX = {fund["id"]: fund for fund in FUND_CATALOG}