#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
申万一级行业估值快照生成器（板块估值 + 抄底/风险指数）

数据源：
  - 乐咕乐股 sw-industry-overview：申万一级 31 行业 PE/PB/股息率 + 历史百分位（页面内嵌）
  - 申万宏源指数发布 API：申万指数日线（近 1 月/3 月/年初至今涨跌幅）
  - 乐咕乐股沪深300 PE 历史 + 东财国债收益率：市场股债利差及其百分位

算法（见 docs/IMPLEMENTATION_STATUS.md 与方案）：
  抄底指数 = 0.3*(100-PE分位) + 0.3*(100-PB分位) + 0.2*股债利差分位
           + 0.1*clamp(-chg_3m*4) + 0.1*股息率分位
  风险指数 = 0.3*PE分位 + 0.3*PB分位 + 0.25*clamp(chg_1m*3) + 0.15*(100-股息率分位)
  信号（按抄底指数）：>=75 极度低估 / 60-75 低估 / 40-60 中性 / 25-40 合理偏高 / <25 高估

用法：
  python scripts/sector_valuation.py --dry-run          # 只输出 CSV，不写库
  SUPABASE_URL=... SUPABASE_SERVICE_KEY=... python scripts/sector_valuation.py   # upsert 到 Supabase
依赖：pip install akshare beautifulsoup4 lxml
"""
import argparse
import json
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore")  # 抑制申万接口 verify=False 的 InsecureRequestWarning

import requests
from bs4 import BeautifulSoup

UA = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )
}
LEGULEGU_URL = "https://www.legulegu.com/stockdata/sw-industry-overview"


def clamp(v, lo=0.0, hi=100.0):
    return max(lo, min(hi, v))


def fetch_sw_first():
    """乐咕乐股：申万一级 31 行业 当前值 + 历史百分位"""
    r = requests.get(LEGULEGU_URL, headers=UA, timeout=30)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "lxml")
    items = soup.select("#level1Items div.lg-industries-item")
    rows = []
    for it in items:
        code = it.get("id")
        num_el = it.select_one(".lg-industries-item-number")
        if not num_el:
            continue
        text = num_el.get_text(strip=True)
        if "(" not in text:
            continue
        name = text.split("(")[0].strip()
        count = text.split("(")[1].rstrip(")").strip()
        vals = [v.get_text(strip=True) for v in it.select(".lg-sw-industries-value > span.value")]
        qs = {}
        for q in it.select("span.quantile"):
            cls = [c for c in q.get("class", []) if c not in ("quantile", "quantile-cover")]
            if cls:
                raw = q.get_text(strip=True).replace("%", "")
                try:
                    qs[cls[0]] = float(raw)
                except ValueError:
                    qs[cls[0]] = None
        row = {
            "sector_code": code,
            "sector_name": name,
            "member_count": int(count) if count.isdigit() else None,
            "pe_static": float(vals[0]) if len(vals) > 0 else None,
            "pe_ttm": float(vals[1]) if len(vals) > 1 else None,
            "pb": float(vals[2]) if len(vals) > 2 else None,
            "div_yield": float(vals[3]) if len(vals) > 3 else None,
            "pe_static_pct": qs.get("peQuantile"),
            "pe_ttm_pct": qs.get("peTtmQuantile"),
            "pb_pct": qs.get("pbQuantile"),
            "div_pct": qs.get("gxlQuantile"),
        }
        if row["sector_code"] and row["sector_name"]:
            rows.append(row)
    return rows


def fetch_sw_daily(symbol):
    """申万宏源：申万指数日线（6 位代码，如 801010）"""
    url = "https://www.swsresearch.com/institute-sw/api/index_publish/trend/"
    params = {"swindexcode": symbol, "period": "DAY"}
    try:
        r = requests.get(url, params=params, headers=UA, timeout=30, verify=False)
        r.raise_for_status()
        data = r.json().get("data") or []
        out = []
        for d in data:
            try:
                out.append(
                    (
                        str(d.get("bargaindate", ""))[:10],
                        float(d.get("closeindex")),
                    )
                )
            except (TypeError, ValueError):
                continue
        out.sort(key=lambda x: x[0])
        return out
    except Exception as e:  # noqa: BLE001
        print(f"  [warn] 申万 {symbol} 日线获取失败: {e}", file=sys.stderr)
        return []


def fetch_market_spread_history():
    """沪深300 PE 历史 + 10 年国债收益率 → 股债利差序列（月度）"""
    try:
        import akshare as ak

        pe = ak.stock_index_pe_lg(symbol="沪深300")
        pe = pe[["日期", "滚动市盈率"]].dropna()
        pe["日期"] = pe["日期"].astype(str)
        bond = ak.bond_zh_us_rate()
        bond = bond[["日期", "中国国债收益率10年"]].dropna()
        bond["日期"] = bond["日期"].astype(str)
        bond_map = dict(zip(bond["日期"], bond["中国国债收益率10年"]))
        dates = sorted(pe["日期"].tolist())
        bond_dates = sorted(bond_map.keys())
        j = 0
        seq = []
        for d in dates:
            while j < len(bond_dates) - 1 and bond_dates[j] < d:
                j += 1
            bd = bond_dates[j] if j < len(bond_dates) else bond_dates[-1]
            if bd > d and j > 0:
                bd = bond_dates[j - 1]
            b = bond_map.get(bd)
            p = pe.loc[pe["日期"] == d, "滚动市盈率"].iloc[0]
            if b and p and p > 0:
                seq.append((d, 100.0 / p - b))
        seq.sort(key=lambda x: x[0])
        return seq
    except Exception as e:  # noqa: BLE001
        print(f"  [warn] 股债利差序列获取失败: {e}", file=sys.stderr)
        return []


def compute_scores(row, spread_pct):
    pe_pct = row.get("pe_ttm_pct")
    pb_pct = row.get("pb_pct")
    div_pct = row.get("div_pct")
    chg_1m = row.get("chg_1m") or 0.0
    chg_3m = row.get("chg_3m") or 0.0
    # 分位缺失时按中性 50 处理（不把缺失当低估/高估）
    pe_part = 100 - (pe_pct if pe_pct is not None else 50)
    pb_part = 100 - (pb_pct if pb_pct is not None else 50)
    div_part = div_pct if div_pct is not None else 50
    spread_part = spread_pct if spread_pct is not None else 50

    opportunity = (
        0.3 * pe_part
        + 0.3 * pb_part
        + 0.2 * spread_part
        + 0.1 * clamp(-chg_3m * 4.0)
        + 0.1 * div_part
    )
    risk = (
        0.3 * (pe_pct if pe_pct is not None else 50)
        + 0.3 * (pb_pct if pb_pct is not None else 50)
        + 0.25 * clamp(chg_1m * 3.0)
        + 0.15 * (100 - div_part)
    )

    if opportunity >= 75:
        signal = "极度低估"
    elif opportunity >= 60:
        signal = "低估"
    elif opportunity >= 40:
        signal = "中性"
    elif opportunity >= 25:
        signal = "合理偏高"
    else:
        signal = "高估"
    return round(opportunity, 1), round(risk, 1), signal


def pct_of(seq, current):
    """当前值在历史序列中的百分位（0-100）：序列中 <= 当前值的比例"""
    if not seq:
        return None
    return round(sum(1 for v in seq if v <= current) / len(seq) * 100, 1)


def upsert_supabase(rows, as_of_date):
    url = os.environ["SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_KEY"]
    payload = [dict(r, as_of_date=as_of_date) for r in rows]
    # 去掉不需要持久化的字段
    for p in payload:
        p.pop("member_count", None)
        p.pop("pe_static", None)
        p.pop("pe_static_pct", None)
    resp = requests.post(
        f"{url}/rest/v1/sector_valuation?on_conflict=sector_code,as_of_date",
        headers={
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        json=payload,
        timeout=30,
    )
    resp.raise_for_status()
    return len(payload)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="只输出 CSV，不写 Supabase")
    ap.add_argument("--json", action="store_true", help="以 JSON 输出（配合 dry-run）")
    args = ap.parse_args()

    print("[1/4] 拉取申万一级行业估值（乐咕乐股）...", file=sys.stderr)
    sectors = fetch_sw_first()
    print(f"  行业数: {len(sectors)}", file=sys.stderr)
    if not sectors:
        print("FATAL: 乐咕乐股数据为空", file=sys.stderr)
        sys.exit(1)

    print("[2/4] 拉取申万指数日线（涨跌幅）...", file=sys.stderr)
    for s in sectors:
        code6 = s["sector_code"].split(".")[0]
        daily = fetch_sw_daily(code6)
        if not daily:
            s["chg_1m"] = s["chg_3m"] = s["chg_ytd"] = None
            continue
        closes = [c for _, c in daily]
        last = closes[-1]
        as_of = daily[-1][0]
        def pct_chg(n):
            if len(closes) > n:
                base = closes[-1 - n]
                if base:
                    return round((last - base) / base * 100, 2)
            return None
        s["chg_1m"] = pct_chg(21)
        s["chg_3m"] = pct_chg(63)
        # 年初至今
        y0 = None
        for d, c in daily:
            if d >= f"{as_of[:4]}-01-01":
                y0 = c
                break
        s["chg_ytd"] = round((last - y0) / y0 * 100, 2) if y0 else None

    print("[3/4] 计算市场股债利差分位...", file=sys.stderr)
    spread_seq = fetch_market_spread_history()
    if spread_seq:
        values = [v for _, v in spread_seq]
        current = values[-1]
        spread_pct = pct_of(values, current)
        print(f"  利差序列 {len(values)} 条，当前 {current:.2f}pp，分位 {spread_pct}%", file=sys.stderr)
    else:
        spread_pct = None

    print("[4/4] 计算抄底/风险指数...", file=sys.stderr)
    as_of = None
    for s in sectors:
        s["equity_bond_spread_pct"] = spread_pct
        s["opportunity_score"], s["risk_score"], s["signal"] = compute_scores(s, spread_pct)
    # as_of 取申万日线最新日期
    for s in sectors:
        if not as_of:
            code6 = s["sector_code"].split(".")[0]
            daily = fetch_sw_daily(code6)
            if daily:
                as_of = daily[-1][0]
        if as_of:
            break
    if not as_of:
        as_of = time.strftime("%Y-%m-%d")

    out_cols = [
        "sector_code", "sector_name", "pe_ttm", "pe_ttm_pct", "pb", "pb_pct",
        "div_yield", "div_pct", "chg_1m", "chg_3m", "chg_ytd",
        "equity_bond_spread_pct", "opportunity_score", "risk_score", "signal",
    ]
    if args.dry_run:
        if args.json:
            print(json.dumps([{k: s.get(k) for k in out_cols} for s in sectors], ensure_ascii=False, indent=2))
        else:
            print("\t".join(out_cols))
            for s in sectors:
                print("\t".join("" if s.get(k) is None else str(s.get(k)) for k in out_cols))
        print(f"\n# as_of_date={as_of}", file=sys.stderr)
        return

    if not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_KEY")):
        print("FATAL: 需要 SUPABASE_URL 与 SUPABASE_SERVICE_KEY 环境变量（或使用 --dry-run）", file=sys.stderr)
        sys.exit(1)
    n = upsert_supabase(sectors, as_of)
    print(f"已写入 {n} 条板块估值记录（as_of_date={as_of}）", file=sys.stderr)


if __name__ == "__main__":
    main()
