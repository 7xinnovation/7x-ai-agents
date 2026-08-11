#!/usr/bin/env python3
"""7X PI branded feedback-status reports (.docx).

Regenerates the premium client-facing status documents. Each report is pure
data at the bottom of this file — edit the data, re-run, and the identity
(logo, Space Grotesk/Inter, brand blue, tables, callouts, footer) is applied
automatically.

  python3 tools/reports/build_reports.py

Requires: pip3 install python-docx  ·  Logo: tools/reports/pilogo-dark.png
"""
import os
from docx import Document
from docx.shared import Pt, Cm, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

# ── 7X PI brand system (pi.7x.ae) ────────────────────────────────────────────
BRAND    = RGBColor(0x00, 0x20, 0xF5)   # --brand: hsl(227 100% 50%)
INK      = RGBColor(0x0F, 0x17, 0x2A)   # slate ink (logo ground)
MUTED    = RGBColor(0x6B, 0x72, 0x80)
DONE     = RGBColor(0x0F, 0x7B, 0x3D)
PARTIAL  = RGBColor(0xB4, 0x53, 0x09)
BLOCKED  = RGBColor(0xDC, 0x26, 0x26)
LINE     = "DCDFEA"                     # --border: hsl(228 20% 89%)
ALT      = "FAFBFE"
HFILL    = "EEF1FE"                     # brand-tinted table header
NFILL    = "F5F7FE"                     # callout fill
FONT     = "Inter"                      # body
HEAD     = "Space Grotesk"              # display
LOGO     = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pilogo-dark.png")
OUT_DIR  = os.path.expanduser("~/Downloads")

def hexc(rgb): return "%02X%02X%02X" % (rgb[0], rgb[1], rgb[2])

# ── low-level helpers ────────────────────────────────────────────────────────
def shade(cell, fill):
    tcPr = cell._tc.get_or_add_tcPr()
    el = OxmlElement("w:shd"); el.set(qn("w:val"), "clear"); el.set(qn("w:fill"), fill)
    tcPr.append(el)

def borders(cell, color=LINE, sz=4, sides=("top", "bottom", "left", "right")):
    tcPr = cell._tc.get_or_add_tcPr()
    b = OxmlElement("w:tcBorders")
    for side in sides:
        e = OxmlElement(f"w:{side}")
        e.set(qn("w:val"), "single"); e.set(qn("w:sz"), str(sz))
        e.set(qn("w:color"), color)
        b.append(e)
    tcPr.append(b)

def cell_margins(cell, top=70, bottom=70, left=110, right=110):
    tcPr = cell._tc.get_or_add_tcPr()
    m = OxmlElement("w:tcMar")
    for side, v in (("top", top), ("bottom", bottom), ("left", left), ("right", right)):
        e = OxmlElement(f"w:{side}"); e.set(qn("w:w"), str(v)); e.set(qn("w:type"), "dxa")
        m.append(e)
    tcPr.append(m)

def run(p, text, size=9.5, bold=False, color=INK, caps=False, spacing=None, italic=False, font=FONT):
    r = p.add_run(text)
    r.font.name = font; r.font.size = Pt(size); r.bold = bold; r.italic = italic
    r.font.color.rgb = color
    rf = r._element.get_or_add_rPr().get_or_add_rFonts()
    rf.set(qn("w:eastAsia"), font); rf.set(qn("w:cs"), font)
    if caps:
        r.font.all_caps = True
    if spacing:
        rPr = r._element.get_or_add_rPr()
        e = OxmlElement("w:spacing"); e.set(qn("w:val"), str(spacing)); rPr.append(e)
    return r

def para(doc, before=0, after=6, line=None):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(before); p.paragraph_format.space_after = Pt(after)
    if line: p.paragraph_format.line_spacing = line
    return p

def spacer(doc, pts=6):
    para(doc, after=pts)

def fixed_layout(t, widths=None):
    """Fixed layout + explicit grid so every table spans the same width."""
    tbl = t._tbl
    tblPr = tbl.tblPr
    layout = OxmlElement("w:tblLayout"); layout.set(qn("w:type"), "fixed")
    tblPr.append(layout)
    if widths:
        dxa = [int(w.cm * 567) for w in widths]
        w = OxmlElement("w:tblW"); w.set(qn("w:w"), str(sum(dxa))); w.set(qn("w:type"), "dxa")
        tblPr.append(w)
        grid = tbl.tblGrid
        if grid is None:
            grid = OxmlElement("w:tblGrid")
            tbl.insert(list(tbl).index(tblPr) + 1, grid)
        for el in list(grid):
            grid.remove(el)
        for d in dxa:
            col = OxmlElement("w:gridCol"); col.set(qn("w:w"), str(d)); grid.append(col)

# ── building blocks ──────────────────────────────────────────────────────────
PAGE_W = Cm(17.0)  # A4 minus 2cm margins

def _bare_cell(c, valign="center"):
    cell_margins(c, top=0, bottom=0, left=0, right=0)
    tcPr = c._tc.get_or_add_tcPr()
    b = OxmlElement("w:tcBorders")
    for side in ("top", "bottom", "left", "right"):
        e = OxmlElement(f"w:{side}"); e.set(qn("w:val"), "nil"); b.append(e)
    tcPr.append(b)
    v = OxmlElement("w:vAlign"); v.set(qn("w:val"), valign); tcPr.append(v)

def title_block(doc, title, meta, accent):
    # Masthead: pi monogram + wordmark stack, kicker on the right.
    t = doc.add_table(rows=1, cols=3)
    fixed_layout(t, [Cm(1.3), Cm(8.7), Cm(7.0)])
    for c in t.rows[0].cells:
        _bare_cell(c)
    lc = t.rows[0].cells[0]
    lp = lc.paragraphs[0]; lp.paragraph_format.space_after = Pt(0)
    lp.add_run().add_picture(LOGO, height=Cm(1.35))
    mc = t.rows[0].cells[1]
    mp = mc.paragraphs[0]; mp.paragraph_format.space_after = Pt(1)
    run(mp, "7X PI", size=14, bold=True, color=INK, font=HEAD, spacing=30)
    mp2 = mc.add_paragraph(); mp2.paragraph_format.space_after = Pt(0)
    run(mp2, "AGENTIC PLATFORM  ·  PI.7X.AE", size=6.5, color=MUTED, font=HEAD, spacing=28)
    rc = t.rows[0].cells[2]
    rp = rc.paragraphs[0]; rp.paragraph_format.space_after = Pt(0)
    rp.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    run(rp, "FEEDBACK ROUND STATUS", size=7.5, bold=True, color=accent, font=HEAD, spacing=30)
    pr = para(doc, after=16)
    pPr = pr._p.get_or_add_pPr()
    b = OxmlElement("w:pBdr"); e = OxmlElement("w:bottom")
    e.set(qn("w:val"), "single"); e.set(qn("w:sz"), "22"); e.set(qn("w:color"), hexc(accent))
    b.append(e); pPr.append(b)

    p = para(doc, after=12)
    run(p, title, size=22, bold=True, color=accent, font=HEAD)

    # Meta strip: single line so Word/QuickLook/Google Docs agree on layout.
    mp = para(doc, after=16, line=1.3)
    for i, (label, value) in enumerate(meta):
        if i:
            run(mp, "    |    ", size=9, color=RGBColor(0xDC, 0xDF, 0xEA))
        run(mp, label + "  ", size=7, bold=True, color=MUTED, font=HEAD, spacing=26)
        run(mp, value, size=9.5, bold=True, color=INK)

def brand_footer(doc):
    sec = doc.sections[0]
    p = sec.footer.paragraphs[0]
    p.paragraph_format.space_before = Pt(4); p.paragraph_format.space_after = Pt(0)
    pPr = p._p.get_or_add_pPr()
    b = OxmlElement("w:pBdr"); e = OxmlElement("w:top")
    e.set(qn("w:val"), "single"); e.set(qn("w:sz"), "4"); e.set(qn("w:color"), LINE)
    b.append(e); pPr.append(b)
    tabs = OxmlElement("w:tabs")
    tab = OxmlElement("w:tab"); tab.set(qn("w:val"), "right"); tab.set(qn("w:pos"), str(int(17.0 * 567)))
    tabs.append(tab); pPr.append(tabs)
    run(p, "7X PI — Agentic Platform  ·  pi.7x.ae", size=7.5, color=MUTED, font=HEAD, spacing=10)
    run(p, "\t", size=7.5, color=MUTED)
    fld = OxmlElement("w:fldSimple"); fld.set(qn("w:instr"), "PAGE")
    r = OxmlElement("w:r"); rPr = OxmlElement("w:rPr")
    rf = OxmlElement("w:rFonts"); rf.set(qn("w:ascii"), FONT); rf.set(qn("w:hAnsi"), FONT); rPr.append(rf)
    sz = OxmlElement("w:sz"); sz.set(qn("w:val"), "15"); rPr.append(sz)
    col = OxmlElement("w:color"); col.set(qn("w:val"), "6B7280"); rPr.append(col)
    r.append(rPr); txt = OxmlElement("w:t"); txt.text = "1"; r.append(txt); fld.append(r)
    p._p.append(fld)

def h2(doc, text, accent=BRAND):
    p = para(doc, before=16, after=6)
    run(p, text, size=13, bold=True, color=accent, font=HEAD)
    pPr = p._p.get_or_add_pPr()
    b = OxmlElement("w:pBdr"); e = OxmlElement("w:bottom")
    e.set(qn("w:val"), "single"); e.set(qn("w:sz"), "8"); e.set(qn("w:color"), hexc(accent))
    b.append(e); pPr.append(b)
    p.paragraph_format.keep_with_next = True

def h3(doc, text):
    p = para(doc, before=10, after=4)
    run(p, text, size=10.5, bold=True, color=INK, font=HEAD)
    p.paragraph_format.keep_with_next = True

def intro(doc, text):
    p = para(doc, after=10, line=1.3)
    run(p, text, size=9, color=MUTED)

def table(doc, headers, rows, widths, header_fill=HFILL, ref_col=None, alt_rows=True):
    """Cells: str | (text, color, bold) | [segments…] where a segment is either."""
    t = doc.add_table(rows=1, cols=len(headers))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    fixed_layout(t, widths)
    for i, h in enumerate(headers):
        c = t.rows[0].cells[i]; c.width = widths[i]
        shade(c, header_fill); borders(c); cell_margins(c)
        p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(0)
        run(p, h, size=8, bold=True, color=MUTED, caps=True, spacing=8)
    for ri, row in enumerate(rows):
        cells = t.add_row().cells
        for ci, val in enumerate(row):
            c = cells[ci]; c.width = widths[ci]
            borders(c); cell_margins(c)
            if alt_rows and ri % 2 == 1: shade(c, ALT)
            p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(0); p.paragraph_format.line_spacing = 1.15
            segs = val if isinstance(val, list) else [val]
            for seg in segs:
                if isinstance(seg, tuple):
                    text, color, bold = seg
                    run(p, text, size=9.5, bold=bold, color=color)
                else:
                    sz, col = (8.5, MUTED) if ci == ref_col else (9.5, INK)
                    run(p, seg, size=sz, bold=False, color=col)
    return t

def callout(doc, segments, fill=NFILL, accent=BRAND):
    t = doc.add_table(rows=1, cols=1)
    fixed_layout(t, [PAGE_W])
    c = t.rows[0].cells[0]; c.width = PAGE_W
    shade(c, fill); cell_margins(c, top=110, bottom=110, left=160, right=160)
    tcPr = c._tc.get_or_add_tcPr()
    b = OxmlElement("w:tcBorders")
    for side in ("top", "bottom", "right"):
        e = OxmlElement(f"w:{side}"); e.set(qn("w:val"), "single"); e.set(qn("w:sz"), "4"); e.set(qn("w:color"), LINE); b.append(e)
    e = OxmlElement("w:left"); e.set(qn("w:val"), "single"); e.set(qn("w:sz"), "24"); e.set(qn("w:color"), hexc(accent)); b.append(e)
    tcPr.append(b)
    p = c.paragraphs[0]; p.paragraph_format.space_after = Pt(0); p.paragraph_format.line_spacing = 1.3
    for text, bold in segments:
        run(p, text, size=8.8, bold=bold, color=RGBColor(0x33, 0x41, 0x5C))
    para(doc, after=2)

def new_doc():
    doc = Document()
    for sct in doc.sections:
        sct.top_margin = Cm(2.0); sct.bottom_margin = Cm(2.0)
        sct.left_margin = Cm(2.0); sct.right_margin = Cm(2.0)
    st = doc.styles["Normal"]
    st.font.name = FONT; st.font.size = Pt(9.5); st.font.color.rgb = INK
    st.element.rPr.rFonts.set(qn("w:eastAsia"), FONT)
    brand_footer(doc)
    return doc

# ═════════════════════════════════════════════════════════════════════════════
# EPGL — Round 2 Feedback · 10 August 2026
# ═════════════════════════════════════════════════════════════════════════════
def build_epgl_round2():
    doc = new_doc()
    title_block(doc, "EPGL Dialog — Feedback Status",
        [("AGENT", "EPGL AI assistant"), ("ROUND", "Round 2 Feedback"), ("UPDATED", "10 August 2026")], BRAND)

    h2(doc, "At a glance")
    table(doc, ["Outcome", "Items", "What it means"],
          [[[("Done", DONE, True)], [("4", INK, True)], "Implemented, verified and live"]],
          [Cm(3.2), Cm(2.0), Cm(11.8)], alt_rows=False)
    spacer(doc, 4)
    callout(doc, [("All four items are live in production.  ", True),
        ("Each is backed by automated checks that read the live configuration and drive the deployed assistant: "
         "35 configuration checks, 12 rendering checks and 17 live conversation checks against production — all "
         "passing. A step-by-step QA guide covers each item individually.", False)])

    h2(doc, "Done — this round")
    table(doc, ["Ref", "What you asked for", "How it works now"], [
        ["FB-1564", "The assistant's communication needs to be more human",
         "It described itself as “government-grade in tone”, which is what it delivered. It now writes like "
         "a colleague — contractions, short sentences, acknowledging what you just did before asking for the next "
         "thing. Precision about documents, fees and timelines is unchanged."],
        ["FB-1565", "Next steps should be clear rather than prompted by the applicant",
         "Every message now ends by naming what happens next, the journey opens by stating its stages, and waits "
         "on EPGL are explained up front. You are also only ever shown one document request at a time."],
        ["FB-1566", "Only the client's preferred contact details should be editable",
         "The edit control now appears on contact details only. Everything read off an official document is locked, "
         "and the rule is enforced by the server — not merely hidden in the interface."],
        ["FB-1567", "A pin location request for the applicant's physical address on Google Maps",
         "A map with a draggable pin now appears in the conversation. Confirming it sends the address, the "
         "coordinates and a Google Maps link, and stores them on the application. Available in Arabic and English."],
    ], [Cm(2.4), Cm(6.4), Cm(8.2)], ref_col=0)

    h2(doc, "Three things to confirm")
    table(doc, ["#", "The question", "Why we are asking"], [
        [[("1", BRAND, True)],
         "The map picker is Mapbox; the pinned location travels as a Google Maps link. Is that what FB-1567 intended?",
         [("The pin opens in Google Maps, which we read as the intent. Making the picker itself Google Maps needs a "
           "Google API key and is a separate change — tell us if that is required.", MUTED, False)]],
        [[("2", BRAND, True)],
         "The quarterly leviable-income figures are now locked along with everything else that is not a contact "
         "detail. Should they stay editable?",
         [("FB-1566 says contact details only, so the rule catches them. They can still be corrected by telling the "
           "assistant. Reversing it is a one-line change.", MUTED, False)]],
        [[("3", BRAND, True)],
         "The map is on the new-licence journey. Should renewals capture a changed address too?",
         [("The renewal journey holds no address field today, so there is nowhere to put a pin without adding one.",
           MUTED, False)]],
    ], [Cm(0.9), Cm(9.3), Cm(6.8)], alt_rows=False)

    h2(doc, "Still open from the previous round")
    intro(doc, "Carried forward from the 4 August status report. Nothing here changed as a result of this round — "
        "each depends on something outside the assistant: the Salesforce contract, and for payment the Network "
        "International gateway.")
    h3(doc, "Partially complete (2)")
    table(doc, ["Ref", "Where it stands"], [
        ["FB-1268 / FB-1269", [("Works for returning customers.  ", PARTIAL, True),
            ("Their company details, Emirates ID and quarterly figures are pre-filled and only confirmed, never "
             "re-typed. The limitation: the profile is reconstructed from that customer's own previous applications, "
             "because Salesforce and IDEP expose no way to read a company profile directly. A brand-new customer "
             "still starts documents-first. Resolves automatically once the read endpoint exists.", INK, False)]],
        ["Renewal — existing company", [("Retested against the sandbox.  ", PARTIAL, True),
            ("The earlier dead end is gone. The renewal finds the existing company, carries all details and reaches "
             "Salesforce, where it stops on a single backend field (ask no. 1 below). The assistant explains this "
             "honestly and hands the customer to an agent with everything already captured — it never claims success "
             "and never loops on retries.", INK, False)]],
    ], [Cm(3.6), Cm(13.4)], ref_col=0, alt_rows=False)
    h3(doc, "Blocked (1)")
    table(doc, ["Ref", "Where it stands"], [
        ["FB-1327", [("Payment in the conversation.  ", BLOCKED, True),
            ("Payment runs through Network International, not Salesforce. The secure payment card, receipts and "
             "confirmation emails are already built on our side; what is missing is the NI gateway credentials, "
             "which sit with Jihas Kutty and have been requested, and three read/write fields from Salesforce — the "
             "amount to charge, somewhere to record the result once NI confirms, and the issued licence document. "
             "Until both land, the assistant shows the issued licence number the moment Salesforce has it and "
             "explains that EPGL sends the payment request after review. It will not offer to take a payment it "
             "cannot take.", INK, False)]],
    ], [Cm(3.6), Cm(13.4)], ref_col=0, alt_rows=False)

    h2(doc, "What we need to unblock these")
    table(doc, ["#", "The ask", "Owner", "Why it matters"], [
        [[("1", BRAND, True)],
         "Unblock renewal submissions — the finance-summary rows require the Salesforce record ID of the customer's "
         "active licence (EPG_License_No__c), and no API operation returns that ID. Either make the field optional / "
         "derive it from the account, or include the licence record ID in the duplicate-check or status response.",
         [("Salesforce", INK, True)],
         [("The one remaining step between a renewal conversation and a completed Salesforce submission. The "
           "assistant uses the ID the moment it exists — no further development needed on our side.", MUTED, False)]],
        [[("2", BRAND, True)],
         "A read endpoint for the company profile and IDEP quarterly figures, keyed by the signed-in customer.",
         [("Salesforce", INK, True)],
         [("Turns the two partial items into complete ones, and extends pre-fill to first-time customers.", MUTED, False)]],
        [[("3", BRAND, True)],
         "The fee amount for a licence request, somewhere to record the payment result once NI confirms, and a link "
         "to the issued licence document. Naming the fields to set on the request record is enough — we write them "
         "through the endpoint we already use.",
         [("Salesforce", INK, True)],
         [("The data side of in-chat payment. Salesforce is not the gateway here; it only needs to say what to "
           "charge and hold the outcome.", MUTED, False)]],
        [[("4", BRAND, True)],
         [("The Network International gateway credentials — API key, outlet reference, base URL — and confirmation "
           "of the outlet and currency.  ", INK, False),
          ("Requested; awaiting response.", PARTIAL, True)],
         [("Jihas Kutty", INK, True)],
         [("The gateway integration is already built and switches from test to live with no code change. Without "
           "these, a fee amount from Salesforce cannot actually be charged.", MUTED, False)]],
    ], [Cm(0.9), Cm(7.0), Cm(2.5), Cm(6.6)], alt_rows=False)

    out = os.path.join(OUT_DIR, "EPGL-Dialog-Feedback-Status-2026-08-10.docx")
    doc.save(out)
    print("wrote", out)

if __name__ == "__main__":
    build_epgl_round2()
