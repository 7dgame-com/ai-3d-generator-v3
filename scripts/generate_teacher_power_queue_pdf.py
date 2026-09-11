from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'output' / 'pdf' / 'ai3d-teacher-power-queue-guide.pdf'
FONT_PATH = Path('/System/Library/AssetsV2/com_apple_MobileAsset_Font8/53fe5be564086fefc7523ccd0a31200acf92e0e5.asset/AssetData/STHEITI.ttf')


def add_page_chrome(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#D7E3F4'))
    canvas.line(doc.leftMargin, A4[1] - 16 * mm, A4[0] - doc.rightMargin, A4[1] - 16 * mm)
    canvas.setFont('TeacherGuide', 8)
    canvas.setFillColor(colors.HexColor('#54708E'))
    canvas.drawString(doc.leftMargin, A4[1] - 12 * mm, 'AI 3D 生成 - 教师说明')
    canvas.drawRightString(A4[0] - doc.rightMargin, 10 * mm, f'第 {doc.page} 页')
    canvas.restoreState()


def p(text, style):
    return Paragraph(text, style)


def build():
    if not FONT_PATH.exists():
        raise RuntimeError(f'缺少中文字体: {FONT_PATH}')
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdfmetrics.registerFont(TTFont('TeacherGuide', str(FONT_PATH)))

    doc = SimpleDocTemplate(
        str(OUTPUT), pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=23 * mm, bottomMargin=18 * mm,
        title='AI 3D 生成：Power、上限、清零与排队说明',
        author='XRUGC Platform',
    )
    styles = getSampleStyleSheet()
    title = ParagraphStyle('TitleCN', parent=styles['Title'], fontName='TeacherGuide', fontSize=22, leading=30,
                           alignment=TA_CENTER, textColor=colors.HexColor('#163A5F'), spaceAfter=7 * mm)
    subtitle = ParagraphStyle('SubtitleCN', parent=styles['Normal'], fontName='TeacherGuide', fontSize=10, leading=16,
                              alignment=TA_CENTER, textColor=colors.HexColor('#54708E'), spaceAfter=9 * mm)
    h1 = ParagraphStyle('H1CN', parent=styles['Heading1'], fontName='TeacherGuide', fontSize=15, leading=22,
                        textColor=colors.HexColor('#163A5F'), spaceBefore=5 * mm, spaceAfter=3 * mm)
    body = ParagraphStyle('BodyCN', parent=styles['BodyText'], fontName='TeacherGuide', fontSize=10.2, leading=17,
                          textColor=colors.HexColor('#243746'), alignment=TA_LEFT, spaceAfter=3 * mm)
    small = ParagraphStyle('SmallCN', parent=body, fontSize=8.8, leading=13)
    table_header = ParagraphStyle('TableHeaderCN', parent=small, textColor=colors.white)
    callout = ParagraphStyle('CalloutCN', parent=body, textColor=colors.HexColor('#173D63'), leftIndent=4 * mm,
                             rightIndent=4 * mm, spaceBefore=2 * mm, spaceAfter=2 * mm)

    story = [
        p('AI 3D 生成：Power、上限、清零与排队说明', title),
        p('给授课老师的课堂操作指南 · 与统一供应商队列实现保持一致', subtitle),
        Table([[p('<b>先记住：</b>Power 决定每位学员本周期还能使用多少；供应商并发决定同一时刻实际能生成多少。两者相互独立，但都会影响任务能否立刻开始。', callout)]],
              colWidths=[174 * mm], style=TableStyle([
                  ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#EAF3FF')),
                  ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#9AC1EA')),
                  ('LEFTPADDING', (0, 0), (-1, -1), 5 * mm),
                  ('RIGHTPADDING', (0, 0), (-1, -1), 5 * mm),
                  ('TOPPADDING', (0, 0), (-1, -1), 3 * mm),
                  ('BOTTOMPADDING', (0, 0), (-1, -1), 3 * mm),
              ])),
        p('一、四个核心概念', h1),
    ]

    concepts = [
        ('Power 上限', '每位学员在当前额度周期可使用的总量。例如上限为 1，表示本周期最多可使用 1 Power。'),
        ('已用与预留', '任务进入本地队列时，系统会先预留预计 Power；这避免同一名学员连续点击占用多份额度。供应商完成后再按实际消耗多退少补。'),
        ('供应商并发', 'Tripo3D、Hyper3D 各自有账号合同允许的同时生成数。并发不是 Power 上限，增加 Power 不会提高供应商并发。'),
        ('清零周期', '清零会建立新的额度周期。清零前供应商已经接单的任务仍会完成，但不会影响新周期的已用 Power。'),
    ]
    concept_rows = [[p('<b>概念</b>', table_header), p('<b>课堂中的含义</b>', table_header)]]
    concept_rows += [[p(f'<b>{name}</b>', small), p(desc, small)] for name, desc in concepts]
    story.append(Table(concept_rows, colWidths=[34 * mm, 140 * mm], repeatRows=1, style=TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#163A5F')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.35, colors.HexColor('#C9D7E5')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('BACKGROUND', (0, 1), (-1, -1), colors.HexColor('#F8FBFF')),
        ('LEFTPADDING', (0, 0), (-1, -1), 3 * mm),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3 * mm),
        ('TOPPADDING', (0, 0), (-1, -1), 2.5 * mm),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5 * mm),
    ])))

    story += [
        p('二、为什么“上限设为 1”后仍可能不能立刻生成', h1),
        p('将上限设为 1，只改变每位学员当前周期是否还有可用 Power；它不会提高 Tripo3D 或 Hyper3D 账号的并发名额，也不能处理供应商余额、授权、网络或限流问题。课堂中多人同时点击时，平台先把任务可靠地写入本地队列，再按供应商可用名额逐项提交。', body),
    ]
    states = [
        ('已进入队列', 'Power 已预留，正在等供应商名额。', '请学生等待，不要重复点击。'),
        ('自动重试', '供应商繁忙或暂时网络错误。', '系统会自动重试，不需要重新提交。'),
        ('正在核对', '平台无法确认供应商是否已接单。', '不要重复提交；请管理员核对诊断。'),
        ('账号暂不可用', '供应商余额或授权需要处理。', '请 root 管理员恢复供应商账号。'),
        ('Power 不足', '本周期上限已被预留或使用。', '按教学安排提高上限或清零。'),
    ]
    state_rows = [[p('<b>状态</b>', table_header), p('<b>含义</b>', table_header), p('<b>老师建议</b>', table_header)]]
    state_rows += [[p(a, small), p(b, small), p(c, small)] for a, b, c in states]
    story.append(Table(state_rows, colWidths=[32 * mm, 79 * mm, 63 * mm], repeatRows=1, style=TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#163A5F')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('GRID', (0, 0), (-1, -1), 0.35, colors.HexColor('#C9D7E5')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F8FBFF')]),
        ('LEFTPADDING', (0, 0), (-1, -1), 2.5 * mm),
        ('RIGHTPADDING', (0, 0), (-1, -1), 2.5 * mm),
        ('TOPPADDING', (0, 0), (-1, -1), 2.4 * mm),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 2.4 * mm),
    ])))

    story += [
        PageBreak(),
        p('三、清零时系统实际做了什么', h1),
        p('清零前，系统会展示预览：受影响学员数、等待任务数、已经被供应商接单的任务数，以及预计释放的 Power。确认后，尚未提交供应商的等待任务会取消并退还预留；已经被供应商接单的任务不会被伪装成取消，而是继续完成或失败。', body),
        p('清零后的新周期从 <b>used_power = 0</b> 开始。旧任务后续成功、失败或退款时，仍写入旧的 quota epoch 审计流水，因此不会把新周期已用额度重新加回去。看到清零前的旧任务后来完成，并不代表清零失效。', body),
        Table([[p('<b>清零确认提示：</b>等待任务会取消并退回预留 Power；供应商已接单任务继续完成，但不计入新周期。', callout)]],
              colWidths=[174 * mm], style=TableStyle([
                  ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor('#FFF6E7')),
                  ('BOX', (0, 0), (-1, -1), 0.5, colors.HexColor('#EDB55B')),
                  ('LEFTPADDING', (0, 0), (-1, -1), 5 * mm),
                  ('RIGHTPADDING', (0, 0), (-1, -1), 5 * mm),
                  ('TOPPADDING', (0, 0), (-1, -1), 3 * mm),
                  ('BOTTOMPADDING', (0, 0), (-1, -1), 3 * mm),
              ])),
        p('四、课堂前后建议', h1),
        p('课前：确认供应商余额、授权和合同并发；用少量测试账号检查排队和下载；分别设置 Power 上限与供应商并发。课堂中：看到“已进入队列”或“自动重试”时，请学生等待而非反复刷新。课后：需要清零时先阅读预览，确认是否要取消尚未提交的等待任务。', body),
        Spacer(1, 3 * mm),
        p('管理员可在运维面板查看供应商并发、有效占槽、队列长度、最老等待、暂停原因和安全告警。遇到余额、授权、持续限流或未知状态时，应由 root 管理员处理，学生不需要重复提交。', body),
    ]
    doc.build(story, onFirstPage=add_page_chrome, onLaterPages=add_page_chrome)


if __name__ == '__main__':
    build()
    print(OUTPUT)
