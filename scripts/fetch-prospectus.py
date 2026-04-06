#!/usr/bin/env python3
"""
EDINET API を使った有価証券届出書（目論見書）自動取得スクリプト
毎朝07:00に実行し、直近7日間の新規IPO届出書を自動検出・ダウンロード
"""
import os
import sys
import json
import time
import requests
from datetime import datetime, timedelta

# APIキーは環境変数から取得（ハードコード禁止）
EDINET_API_KEY = os.getenv("EDINET_API_KEY")
SAVE_DIR = os.path.join(os.path.dirname(__file__), "..", "employees", "data", "prospectus")
WATCHLIST_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "edinet-watchlist.md")
CALENDAR_PATH = os.path.join(os.path.dirname(__file__), "..", "config", "ipo-calendar.md")


def check_api_key():
    """APIキーの存在確認"""
    if not EDINET_API_KEY:
        print("[ERROR] EDINET_API_KEY が未設定です。")
        print("取得手順:")
        print("  1. https://api.edinet-fsa.go.jp/api/auth/index.aspx?mode=1 にアクセス")
        print("  2. アカウント作成 → サインイン → APIキー発行")
        print("  3. .env に EDINET_API_KEY=取得したキー を追記")
        sys.exit(1)


def search_ipo_filings(days_back=7):
    """直近N日間の提出書類から有価証券届出書を検索"""
    results = []
    end_date = datetime.now()
    start_date = end_date - timedelta(days=days_back)

    current = start_date
    while current <= end_date:
        date_str = current.strftime("%Y-%m-%d")
        print(f"[INFO] {date_str} の書類を検索中...")

        url = "https://api.edinet-fsa.go.jp/api/v2/documents.json"
        params = {
            "date": date_str,
            "type": 2,
            "Subscription-Key": EDINET_API_KEY
        }

        try:
            res = requests.get(url, params=params, timeout=30)
            if res.status_code == 200:
                data = res.json()
                for doc in data.get("results", []):
                    # docTypeCode: 030=有価証券届出書, 050=届出書(訂正)
                    doc_type = doc.get("docTypeCode")
                    if doc_type in ["030", "050"]:
                        results.append({
                            "docID": doc["docID"],
                            "filerName": doc.get("filerName", ""),
                            "docDescription": doc.get("docDescription", ""),
                            "submitDateTime": doc.get("submitDateTime", ""),
                            "secCode": doc.get("secCode", ""),
                            "edinetCode": doc.get("edinetCode", ""),
                            "docTypeCode": doc_type,
                            "date": date_str
                        })
            elif res.status_code == 401:
                print("[ERROR] APIキーが無効です。")
                sys.exit(1)
            else:
                print(f"[WARN] HTTP {res.status_code} for {date_str}")
        except requests.exceptions.RequestException as e:
            print(f"[WARN] リクエストエラー ({date_str}): {e}")

        time.sleep(1)  # レート制限対策
        current += timedelta(days=1)

    return results


def download_pdf(doc_id):
    """有価証券届出書のPDFをダウンロード"""
    os.makedirs(SAVE_DIR, exist_ok=True)
    filepath = os.path.join(SAVE_DIR, f"{doc_id}.pdf")

    if os.path.exists(filepath):
        print(f"[SKIP] 既にダウンロード済み: {doc_id}")
        return filepath

    url = f"https://api.edinet-fsa.go.jp/api/v2/documents/{doc_id}"
    params = {
        "type": 2,  # 2 = PDFファイル
        "Subscription-Key": EDINET_API_KEY
    }

    try:
        res = requests.get(url, params=params, timeout=60)
        if res.status_code == 200:
            with open(filepath, "wb") as f:
                f.write(res.content)
            print(f"[OK] ダウンロード完了: {filepath}")
            return filepath
        else:
            print(f"[ERROR] ダウンロード失敗 ({doc_id}): HTTP {res.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"[ERROR] ダウンロードエラー ({doc_id}): {e}")

    return None


def search_company(company_name, days_back=90):
    """特定企業の有価証券届出書を検索"""
    all_filings = search_ipo_filings(days_back=days_back)
    return [f for f in all_filings if company_name in f.get("filerName", "")]


def main():
    """メイン実行"""
    check_api_key()

    print("=" * 50)
    print(f"EDINET 目論見書自動取得 - {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print("=" * 50)

    # 直近7日の有価証券届出書を検索
    filings = search_ipo_filings(days_back=7)
    print(f"\n[RESULT] 有価証券届出書: {len(filings)}件発見")

    if not filings:
        print("[INFO] 新規届出書なし。終了します。")
        return

    # 各届出書を表示＆ダウンロード
    for f in filings:
        print(f"\n--- {f['filerName']} ({f['secCode'] or 'コード未定'}) ---")
        print(f"  docID: {f['docID']}")
        print(f"  提出日: {f['submitDateTime']}")
        print(f"  種類: {'有価証券届出書' if f['docTypeCode'] == '030' else '訂正届出書'}")
        print(f"  説明: {f['docDescription']}")

        # PDFダウンロード
        download_pdf(f["docID"])
        time.sleep(1)

    print(f"\n[DONE] {len(filings)}件の処理完了")
    print(f"保存先: {os.path.abspath(SAVE_DIR)}")


if __name__ == "__main__":
    main()
