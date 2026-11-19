"""Downloadable dashboard reports: Excel (.xlsx) and PDF.

A report covers one seller (or, for the platform manager, the whole marketplace)
over a period: 30 days, 90 days, 12 months or all time. It contains the same
figures as the dashboard — sales, crochets available, orders, pending payments,
pieces sold, stock value, custom work, page views — plus monthly totals, the
orders, the stock list, best sellers and daily page views.
"""
from __future__ import annotations

import io
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from flask import current_app

from . import analytics
from .db import get_db, loads, today, usd_to_lrd

PERIODS = {"30d": ("Last 30 days", 30), "90d": ("Last 90 days", 90), "365d": ("Last 12 months", 365), "all": ("All time", None)}
SALE = ("Paid", "Delivered")
OPEN = ("New", "Confirmed")
COUNTS_STOCK = ("Confirmed", "Paid", "Delivered")
TEAL = "0F766E"


# ===========================================================================
# Data
# ===========================================================================
def _order_value(o) -> float:
    if o["type"] == "cart":
        return float(o["total"] or 0)
    return float(o["quote"]) if o["quote"] is not None else 0.0


def build_report(seller_id: int | None, period: str) -> dict:
    """Everything a report needs, already calculated. seller_id None = whole marketplace."""
    period = period if period in PERIODS else "30d"
    label, days = PERIODS[period]
    db = get_db()
    end = date.fromisoformat(today())
    start = (end - timedelta(days=days - 1)) if days else None
    rate = usd_to_lrd()
    low_at = int(current_app.config["SHOP"]["lowStockAt"])

    seller = db.execute("SELECT * FROM sellers WHERE id = ?", (seller_id,)).fetchone() if seller_id else None
    sellers = {r["id"]: r["name"] for r in db.execute("SELECT id, name FROM sellers")}

    where, args = ("seller_id = ?", [seller_id]) if seller_id else ("1 = 1", [])
    products = db.execute(f"SELECT * FROM products WHERE {where} ORDER BY name", args).fetchall()
    o_where, o_args = where, list(args)
    if start:
        o_where += " AND created_at >= ?"
        o_args.append(start.isoformat())
    orders = db.execute(f"SELECT * FROM orders WHERE {o_where} ORDER BY created_at DESC", o_args).fetchall()
    if not start:
        start = min((date.fromisoformat(o["created_at"][:10]) for o in orders), default=end)

    active = [p for p in products if p["active"]]
    sales = [o for o in orders if o["status"] in SALE]
    open_ = [o for o in orders if o["status"] in OPEN]

    # pieces sold & best sellers in the period (from confirmed shop orders)
    sold_by_product: dict[str, dict] = {}
    for o in orders:
        if o["type"] != "cart" or o["status"] not in COUNTS_STOCK:
            continue
        for it in loads(o["items"], []):
            row = sold_by_product.setdefault(it.get("id"), {"name": it.get("name", ""), "qty": 0, "value": 0.0})
            row["qty"] += int(it.get("qty") or 0)
            row["value"] += float(it.get("price") or 0) * int(it.get("qty") or 0)
    best = sorted(sold_by_product.values(), key=lambda r: (-r["qty"], -r["value"]))[:10]

    # month by month
    months: dict[str, dict] = {}
    m = date(start.year, start.month, 1)
    while m <= end:
        months[m.strftime("%Y-%m")] = {"month": m.strftime("%b %Y"), "sales": 0.0, "paid_orders": 0, "orders": 0, "pieces": 0}
        m = date(m.year + (m.month == 12), m.month % 12 + 1, 1)
    for o in orders:
        key = o["created_at"][:7]
        if key not in months:
            continue
        months[key]["orders"] += 1
        if o["status"] in SALE:
            months[key]["sales"] += _order_value(o)
            months[key]["paid_orders"] += 1
        if o["type"] == "cart" and o["status"] in COUNTS_STOCK:
            months[key]["pieces"] += sum(int(i.get("qty") or 0) for i in loads(o["items"], []))

    view_days = (end - start).days + 1
    views = analytics.seller_summary(seller_id, max(1, min(view_days, 3650)))

    summary = {
        "total_sales": sum(_order_value(o) for o in sales),
        "paid_orders": len(sales),
        "available": sum(p["stock"] for p in active),
        "styles": len(active),
        "stock_value": sum(p["stock"] * p["price"] for p in active),
        "orders": len(orders),
        "new_orders": sum(1 for o in orders if o["status"] == "New"),
        "pending_value": sum(_order_value(o) for o in open_),
        "pending_orders": len(open_),
        "pieces_sold": sum(r["qty"] for r in sold_by_product.values()),
        "custom_work": sum(1 for o in orders if o["type"] == "custom" or o["is_custom_work"]),
        "cancelled": sum(1 for o in orders if o["status"] == "Cancelled"),
        "low_stock": sum(1 for p in active if 0 < p["stock"] <= low_at),
        "sold_out": sum(1 for p in active if p["stock"] <= 0),
        "page_views": views["adPageViews"], "shop_views": views["storeViews"], "product_views": views["productPageViews"],
        "product_opens": views["productOpens"], "unique_visitors": views["uniqueVisitors"],
    }
    summary["avg_order"] = summary["total_sales"] / summary["paid_orders"] if summary["paid_orders"] else 0.0

    by_seller = []
    if not seller_id:
        for sid, name in sorted(sellers.items(), key=lambda x: x[1].lower()):
            s_orders = [o for o in orders if o["seller_id"] == sid]
            s_products = [p for p in active if p["seller_id"] == sid]
            by_seller.append({
                "name": name,
                "sales": sum(_order_value(o) for o in s_orders if o["status"] in SALE),
                "available": sum(p["stock"] for p in s_products),
                "orders": len(s_orders),
                "pending": sum(_order_value(o) for o in s_orders if o["status"] in OPEN),
                "views": analytics.seller_summary(sid, max(1, min(view_days, 3650)))["adPageViews"],
            })

    return {
        "title": seller["name"] if seller else f"{current_app.config['SHOP']['name']} — all sellers",
        "slug": seller["slug"] if seller else "all-sellers",
        "owner": seller["owner_name"] if seller else "",
        "period": period, "period_label": label, "start": start, "end": end,
        "generated": datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC"),
        "rate": rate, "summary": summary, "months": list(months.values()), "best": best,
        "orders": [{
            "date": o["created_at"][:16].replace("T", " "), "id": o["id"], "shop": sellers.get(o["seller_id"], ""),
            "type": "Custom" if o["type"] == "custom" else ("Made to order" if o["is_custom_work"] else "Shop"),
            "customer": o["customer_name"], "phone": o["customer_phone"],
            "items": ", ".join(f"{i.get('qty')}× {i.get('name')}" for i in loads(o["items"], [])) if o["type"] == "cart"
                     else f"Custom {(loads(o['custom'], {}) or {}).get('type', '')}",
            "handoff": o["delivery"] + (f" — {o['pickup_spot']}" if o["pickup_spot"] else "") + (f" ({o['pickup_day']})" if o["pickup_day"] else ""),
            "value": _order_value(o), "rate": o["lrd_rate"] or rate, "status": o["status"],
        } for o in orders],
        "products": [{
            "name": p["name"], "shop": sellers.get(p["seller_id"], ""), "category": p["category"], "price": p["price"],
            "stock": p["stock"], "sold": p["sold"], "stock_value": p["stock"] * p["price"],
            "status": ("Hidden" if not p["active"] else "Sold out" if p["stock"] <= 0 else "Low" if p["stock"] <= low_at else "In stock"),
            "made_to_order": "Yes" if p["custom_enabled"] else "",
        } for p in products],
        "views_daily": views["series"],
        "by_seller": by_seller,
        "manager_view": not seller_id,
    }


def filename(rep: dict, ext: str) -> str:
    return f"crochets-market-{rep['slug']}-{rep['period']}-{rep['end'].isoformat()}.{ext}"


# ===========================================================================
# Excel
# ===========================================================================
def to_xlsx(rep: dict) -> bytes:
    from openpyxl import Workbook
    from openpyxl.chart import BarChart, Reference
    from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
    from openpyxl.utils import get_column_letter

    USD = '"US$"#,##0.00'
    LRD = '"L$"#,##0'
    head_font = Font(bold=True, color="FFFFFF")
    head_fill = PatternFill("solid", fgColor=TEAL)
    thin = Side(style="thin", color="E2E6EA")
    entity = current_app.config["PARENT_COMPANY"]
    shop = current_app.config["SHOP"]["name"]

    wb = Workbook()

    def put(ws, row, col, value, fmt=None, bold=False):
        c = ws.cell(row=row, column=col, value=value)
        if isinstance(value, str):
            c.data_type = "s"          # text stays text — never runs as a formula
        if fmt:
            c.number_format = fmt
        if bold:
            c.font = Font(bold=True)
        return c

    def table(ws, top, headers, rows, formats=None, widths=None):
        formats = formats or {}
        for j, h in enumerate(headers, 1):
            c = put(ws, top, j, h)
            c.font, c.fill = head_font, head_fill
            c.alignment = Alignment(vertical="center", wrap_text=True)
        for i, r in enumerate(rows, top + 1):
            for j, v in enumerate(r, 1):
                c = put(ws, i, j, v, formats.get(j))
                c.border = Border(bottom=thin)
        for j, w in enumerate(widths or [], 1):
            ws.column_dimensions[get_column_letter(j)].width = w
        ws.freeze_panes = ws.cell(row=top + 1, column=1)
        if rows:
            ws.auto_filter.ref = f"A{top}:{get_column_letter(len(headers))}{top + len(rows)}"
        return top + len(rows)

    # ---- Summary ----
    s, rate = rep["summary"], rep["rate"]
    ws = wb.active
    ws.title = "Summary"
    ws["A1"] = f"{rep['title']} — sales report"
    ws["A1"].font = Font(bold=True, size=16, color=TEAL)
    put(ws, 2, 1, f"{rep['period_label']} ({rep['start']:%d %b %Y} – {rep['end']:%d %b %Y}) · generated {rep['generated']}")
    put(ws, 3, 1, f"{shop}, a subsidiary of {entity} · rate used for L$: US$1 = L${rate:g}")
    for r in (2, 3):
        ws.cell(row=r, column=1).font = Font(color="5F6B7A", italic=True)
    kpis = [
        ("Total sales (paid & delivered)", s["total_sales"], USD, True),
        ("Paid orders", s["paid_orders"], "0", False),
        ("Average paid order", s["avg_order"], USD, True),
        ("Crochets available (pieces)", s["available"], "0", False),
        ("Styles in the shop", s["styles"], "0", False),
        ("Stock value", s["stock_value"], USD, True),
        ("Orders received", s["orders"], "0", False),
        ("New orders waiting", s["new_orders"], "0", False),
        ("Pending (new + confirmed)", s["pending_value"], USD, True),
        ("Pending orders", s["pending_orders"], "0", False),
        ("Pieces sold", s["pieces_sold"], "0", False),
        ("Custom / made-to-order work", s["custom_work"], "0", False),
        ("Cancelled orders", s["cancelled"], "0", False),
        ("Styles low on stock", s["low_stock"], "0", False),
        ("Styles sold out", s["sold_out"], "0", False),
        ("Page views (shop + product pages)", s["page_views"], "#,##0", False),
        ("Shop page views", s["shop_views"], "#,##0", False),
        ("Product page views", s["product_views"], "#,##0", False),
        ("Product pop-up opens", s["product_opens"], "#,##0", False),
        ("Unique visitors", s["unique_visitors"], "#,##0", False),
    ]
    rows = [[label, value, (value * rate if lrd else None)] for label, value, fmt, lrd in kpis]
    end_row = table(ws, 5, ["Figure", "Value", "In L$"], rows, widths=[38, 18, 16])
    for i, (_, _, fmt, lrd) in enumerate(kpis, 6):
        ws.cell(row=i, column=2).number_format = fmt
        if lrd:
            ws.cell(row=i, column=3).number_format = LRD
    ws.freeze_panes = None
    ws.auto_filter.ref = None
    put(ws, end_row + 2, 1, "Sales count orders marked Paid or Delivered. Pieces sold count Confirmed, Paid and Delivered shop orders.").font = Font(color="5F6B7A", italic=True)

    # ---- Monthly ----
    ws = wb.create_sheet("Monthly")
    rows = [[m["month"], m["sales"], m["sales"] * rate, m["paid_orders"], m["orders"], m["pieces"]] for m in rep["months"]]
    last = table(ws, 1, ["Month", "Sales (US$)", "Sales (L$)", "Paid orders", "All orders", "Pieces sold"], rows,
                 {2: USD, 3: LRD}, [14, 16, 16, 12, 12, 12])
    if rows:
        ch = BarChart()
        ch.title, ch.y_axis.title = "Sales by month (US$)", "US$"
        ch.add_data(Reference(ws, min_col=2, min_row=1, max_row=last), titles_from_data=True)
        ch.set_categories(Reference(ws, min_col=1, min_row=2, max_row=last))
        ch.height, ch.width, ch.legend = 8, 18, None
        ws.add_chart(ch, "H2")

    # ---- Orders ----
    ws = wb.create_sheet("Orders")
    head = ["Date", "Order #"] + (["Shop"] if rep["manager_view"] else []) + ["Type", "Customer", "Phone", "Items", "Handoff",
                                                                              "Value (US$)", "Value (L$)", "Rate", "Status"]
    rows = []
    for o in rep["orders"]:
        r = [o["date"], o["id"]] + ([o["shop"]] if rep["manager_view"] else []) + [
            o["type"], o["customer"], o["phone"], o["items"], o["handoff"], o["value"], round(o["value"] * o["rate"]), o["rate"], o["status"]]
        rows.append(r)
    off = 1 if rep["manager_view"] else 0
    table(ws, 1, head, rows, {9 + off: USD, 10 + off: LRD},
          [17, 16] + ([20] if off else []) + [14, 20, 16, 40, 28, 13, 13, 8, 12])

    # ---- Crochets (stock) ----
    ws = wb.create_sheet("Crochets")
    head = ["Crochet"] + (["Shop"] if rep["manager_view"] else []) + ["Category", "Price (US$)", "Price (L$)", "In stock", "Sold (all time)",
                                                                       "Stock value (US$)", "Status", "Made to order"]
    rows = [[p["name"]] + ([p["shop"]] if rep["manager_view"] else []) + [p["category"], p["price"], round(p["price"] * rate), p["stock"], p["sold"],
            p["stock_value"], p["status"], p["made_to_order"]] for p in rep["products"]]
    table(ws, 1, head, rows, {3 + off: USD, 4 + off: LRD, 7 + off: USD}, [30] + ([20] if off else []) + [14, 13, 12, 10, 14, 16, 11, 13])

    # ---- Best sellers ----
    ws = wb.create_sheet("Best sellers")
    table(ws, 1, ["Crochet", "Pieces sold", "Sales value (US$)", "Sales value (L$)"],
          [[b["name"], b["qty"], b["value"], round(b["value"] * rate)] for b in rep["best"]], {3: USD, 4: LRD}, [32, 13, 18, 18])

    # ---- Page views ----
    ws = wb.create_sheet("Page views")
    table(ws, 1, ["Day", "Page views"], [[d["day"], d["views"]] for d in rep["views_daily"]], None, [14, 12])

    # ---- Sellers (manager, all sellers) ----
    if rep["manager_view"]:
        ws = wb.create_sheet("Sellers", 1)
        table(ws, 1, ["Seller", "Sales (US$)", "Available pieces", "Orders", "Pending (US$)", "Page views"],
              [[b["name"], b["sales"], b["available"], b["orders"], b["pending"], b["views"]] for b in rep["by_seller"]],
              {2: USD, 5: USD}, [28, 15, 16, 10, 15, 12])

    wb.properties.title = f"{rep['title']} — {rep['period_label']}"
    wb.properties.creator = f"{shop} ({entity})"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ===========================================================================
# PDF
# ===========================================================================
def _latin(text) -> str:
    """The built-in PDF fonts only cover Western characters; swap anything else so it never breaks."""
    return str(text if text is not None else "").replace("×", "x").replace("—", "-").replace("–", "-") \
        .encode("cp1252", "replace").decode("cp1252")


def to_pdf(rep: dict) -> bytes:
    from reportlab.graphics.charts.barcharts import VerticalBarChart
    from reportlab.graphics.shapes import Drawing
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Image, KeepTogether, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    teal, ink, muted, line = colors.HexColor("#0F766E"), colors.HexColor("#1E293B"), colors.HexColor("#5F6B7A"), colors.HexColor("#E2E6EA")
    soft = colors.HexColor("#DDF1EE")
    entity = current_app.config["PARENT_COMPANY"]
    shop = current_app.config["SHOP"]["name"]
    rate = rep["rate"]
    usd = lambda v: f"US${v:,.2f}".replace(".00", "")
    lrd = lambda v: f"L${round(v * rate):,}"

    ss = getSampleStyleSheet()
    h1 = ParagraphStyle("h1", parent=ss["Title"], fontName="Helvetica-Bold", fontSize=20, textColor=ink, alignment=0, spaceAfter=2)
    h2 = ParagraphStyle("h2", parent=ss["Heading2"], fontName="Helvetica-Bold", fontSize=13, textColor=teal, spaceBefore=12, spaceAfter=6, keepWithNext=1)
    small = ParagraphStyle("small", parent=ss["Normal"], fontSize=8.5, textColor=muted, leading=11)
    cell = ParagraphStyle("cell", parent=ss["Normal"], fontSize=8, leading=10, textColor=ink)
    P = lambda t, st=cell: Paragraph(_latin(t).replace("&", "&amp;").replace("<", "&lt;"), st)

    def grid(data, widths, align_right=(), zebra=True):
        t = Table(data, colWidths=widths, repeatRows=1)
        style = [
            ("BACKGROUND", (0, 0), (-1, 0), teal), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"), ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LINEBELOW", (0, 1), (-1, -1), 0.4, line),
            ("TOPPADDING", (0, 0), (-1, -1), 4), ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]
        for c in align_right:
            style.append(("ALIGN", (c, 0), (c, -1), "RIGHT"))
        if zebra:
            for r in range(2, len(data), 2):
                style.append(("BACKGROUND", (0, r), (-1, r), colors.HexColor("#F6F7F8")))
        t.setStyle(TableStyle(style))
        return t

    story = []
    logo = Path(current_app.static_folder) / "icons" / "logo.png"
    head = [[Image(str(logo), width=14 * mm, height=14 * mm) if logo.exists() else "",
             [Paragraph(_latin(f"{rep['title']}"), h1),
              Paragraph(_latin(f"Sales report · {rep['period_label']} ({rep['start']:%d %b %Y} - {rep['end']:%d %b %Y})"), small)]]]
    ht = Table(head, colWidths=[18 * mm, 160 * mm])
    ht.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "MIDDLE"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    story += [ht, Spacer(1, 3 * mm),
              Paragraph(_latin(f"Generated {rep['generated']} · Prices in US$ with L$ at US$1 = L${rate:g}"), small),
              Spacer(1, 4 * mm)]

    # key figures (2 columns of cards)
    s = rep["summary"]
    cards = [
        ("Total sales", usd(s["total_sales"]), lrd(s["total_sales"]) + f" · {s['paid_orders']} paid orders"),
        ("Crochets available", f"{s['available']:,}", f"pieces across {s['styles']} styles"),
        ("Orders", f"{s['orders']:,}", f"{s['new_orders']} new waiting"),
        ("Pending", usd(s["pending_value"]), f"{lrd(s['pending_value'])} · {s['pending_orders']} open orders"),
        ("Pieces sold", f"{s['pieces_sold']:,}", "confirmed, paid & delivered"),
        ("Stock value", usd(s["stock_value"]), lrd(s["stock_value"])),
        ("Custom work", f"{s['custom_work']:,}", "custom & made-to-order orders"),
        ("Low / sold out", f"{s['low_stock']} / {s['sold_out']}", "styles to restock"),
        ("Page views", f"{s['page_views']:,}", f"shop {s['shop_views']:,} · products {s['product_views']:,}"),
        ("Unique visitors", f"{s['unique_visitors']:,}", f"{s['product_opens']:,} product opens"),
    ]
    kstyle = ParagraphStyle("k", parent=cell, fontSize=7.5, textColor=muted)
    vstyle = ParagraphStyle("v", parent=cell, fontName="Helvetica-Bold", fontSize=14, leading=17, textColor=ink)
    cells = [[P(label.upper(), kstyle), P(val, vstyle), P(sub, kstyle)] for label, val, sub in cards]
    rows = [[cells[i], cells[i + 1] if i + 1 < len(cells) else ""] for i in range(0, len(cells), 2)]
    kt = Table(rows, colWidths=[88 * mm, 88 * mm])
    kt.setStyle(TableStyle([("BOX", (0, 0), (-1, -1), 0, colors.white), ("INNERGRID", (0, 0), (-1, -1), 4, colors.white),
                            ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#F6F7F8")), ("BACKGROUND", (0, 0), (0, 0), soft),
                            ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story.append(kt)

    # monthly chart + table
    months = rep["months"][-12:]
    if months:
        story.append(Paragraph("Sales by month", h2))
        d = Drawing(176 * mm, 55 * mm)
        bc = VerticalBarChart()
        bc.x, bc.y, bc.width, bc.height = 10 * mm, 8 * mm, 160 * mm, 42 * mm
        bc.data = [[round(m["sales"], 2) for m in months]]
        bc.categoryAxis.categoryNames = [m["month"][:3] for m in months]
        bc.categoryAxis.labels.fontSize = 7
        bc.valueAxis.labels.fontSize = 7
        bc.valueAxis.valueMin = 0
        bc.valueAxis.valueMax = max(10, max(bc.data[0]) * 1.15)
        bc.bars[0].fillColor = teal
        bc.bars[0].strokeColor = None
        d.add(bc)
        story.append(d)
        data = [["Month", "Sales (US$)", "Sales (L$)", "Paid orders", "All orders", "Pieces sold"]] + [
            [m["month"], usd(m["sales"]), lrd(m["sales"]), m["paid_orders"], m["orders"], m["pieces"]] for m in months]
        story.append(grid(data, [30 * mm, 30 * mm, 30 * mm, 26 * mm, 26 * mm, 26 * mm], align_right=(1, 2, 3, 4, 5)))

    if rep["manager_view"] and rep["by_seller"]:
        story.append(Paragraph("Sellers", h2))
        data = [["Seller", "Sales", "Available", "Orders", "Pending", "Page views"]] + [
            [P(b["name"]), usd(b["sales"]), b["available"], b["orders"], usd(b["pending"]), f"{b['views']:,}"] for b in rep["by_seller"]]
        story.append(grid(data, [56 * mm, 26 * mm, 22 * mm, 20 * mm, 26 * mm, 24 * mm], align_right=(1, 2, 3, 4, 5)))

    if rep["best"]:
        story.append(KeepTogether([Paragraph("Best sellers", h2), grid(
            [["Crochet", "Pieces sold", "Sales (US$)", "Sales (L$)"]] + [[P(b["name"]), b["qty"], usd(b["value"]), lrd(b["value"])] for b in rep["best"]],
            [80 * mm, 30 * mm, 33 * mm, 33 * mm], align_right=(1, 2, 3))]))

    story.append(Paragraph("Orders", h2))
    if rep["orders"]:
        shown = rep["orders"][:150]
        data = [["Date", "Order #", "Customer", "Items", "Value", "Status"]] + [
            [o["date"][:10], o["id"], P(o["customer"]), P((o["shop"] + ": " if rep["manager_view"] else "") + o["items"]),
             usd(o["value"]), o["status"]] for o in shown]
        story.append(grid(data, [20 * mm, 28 * mm, 30 * mm, 62 * mm, 20 * mm, 18 * mm], align_right=(4,)))
        if len(rep["orders"]) > len(shown):
            story.append(Paragraph(f"Showing the latest {len(shown)} of {len(rep['orders'])} orders — download the Excel file for all of them.", small))
    else:
        story.append(Paragraph("No orders in this period.", small))

    story.append(Paragraph("Crochets & stock", h2))
    data = [["Crochet", "Price", "In stock", "Sold", "Stock value", "Status"]] + [
        [P((p["shop"] + ": " if rep["manager_view"] else "") + p["name"]), usd(p["price"]), p["stock"], p["sold"], usd(p["stock_value"]), p["status"]]
        for p in rep["products"][:200]]
    story.append(grid(data, [70 * mm, 22 * mm, 18 * mm, 16 * mm, 28 * mm, 24 * mm], align_right=(1, 2, 3, 4)))

    def footer(canvas, doc_):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(muted)
        canvas.drawString(18 * mm, 10 * mm, _latin(f"{shop}, a subsidiary of {entity} · Confidential - for {rep['title']} only"))
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, f"Page {doc_.page}")
        canvas.restoreState()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=16 * mm, rightMargin=16 * mm, topMargin=14 * mm, bottomMargin=18 * mm,
                            title=_latin(f"{rep['title']} - {rep['period_label']}"), author=_latin(f"{shop} ({entity})"))
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buf.getvalue()
