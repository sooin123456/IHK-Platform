using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;

namespace Lukas.Qto.Core
{
    public static class Report
    {
        public static void Write(string path, IEnumerable<Finding> findings)
        {
            var rows = new List<string[]> { new[] { "규칙", "상태", "심각도", "내역ID", "검산키", "단위", "기대값", "실제값", "차이", "근거", "설명" } };
            foreach (var finding in findings) rows.Add(new[] {
                Csv.SpreadsheetText(finding.Rule), Csv.SpreadsheetText(finding.Status), Csv.SpreadsheetText(finding.Severity),
                Csv.SpreadsheetText(finding.LineId), Csv.SpreadsheetText(finding.QtoId), Csv.SpreadsheetText(finding.Unit),
                Number(finding.Expected), Number(finding.Actual), Number(finding.Delta), Csv.SpreadsheetText(finding.Evidence), Csv.SpreadsheetText(finding.Message)
            });
            Csv.Write(path, rows);
        }

        public static void WriteHtml(string path, IEnumerable<Finding> findings, string manifestFileName)
        {
            var items = findings.ToList();
            var html = new StringBuilder();
            html.Append("<!doctype html><html lang=\"ko\"><head><meta charset=\"utf-8\"><title>BIM 견적 사전검토</title>");
            html.Append("<style>body{font-family:system-ui,sans-serif;margin:32px;color:#17212b}h1{margin-bottom:4px}.summary{display:flex;gap:12px;margin:20px 0}.card{padding:12px 16px;border:1px solid #d8dee4;border-radius:8px}.fail{color:#b42318}.review{color:#9a6700}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #d8dee4;padding:8px;text-align:left;vertical-align:top}th{background:#f6f8fa}code{font-family:ui-monospace,monospace}</style></head><body>");
            html.Append("<h1>BIM 견적 사전검토 결과</h1><p>규칙 ").Append(RunManifest.RulesetVersion).Append(" · 수량·금액 계산은 결정론적 규칙으로 수행됩니다.</p>");
            html.Append("<div class=\"summary\"><div class=\"card\">전체 <strong>").Append(items.Count).Append("</strong></div>");
            html.Append("<div class=\"card fail\">실패 <strong>").Append(items.Count(x => x.Status == "FAIL")).Append("</strong></div>");
            html.Append("<div class=\"card review\">검토 필요 <strong>").Append(items.Count(x => x.Status == "REVIEW" || x.Status == "NOT_EVALUATED")).Append("</strong></div></div>");
            html.Append("<p>실행 근거: <code>").Append(Escape(manifestFileName)).Append("</code></p><table><thead><tr><th>규칙</th><th>상태</th><th>심각도</th><th>내역ID</th><th>검산키</th><th>단위</th><th>기대값</th><th>실제값</th><th>차이</th><th>근거</th><th>설명</th></tr></thead><tbody>");
            foreach (var finding in items)
            {
                html.Append("<tr><td>").Append(Escape(finding.Rule)).Append("</td><td>").Append(Escape(finding.Status)).Append("</td><td>").Append(Escape(finding.Severity)).Append("</td><td>").Append(Escape(finding.LineId)).Append("</td><td>").Append(Escape(finding.QtoId)).Append("</td><td>").Append(Escape(finding.Unit)).Append("</td><td>").Append(Escape(Number(finding.Expected))).Append("</td><td>").Append(Escape(Number(finding.Actual))).Append("</td><td>").Append(Escape(Number(finding.Delta))).Append("</td><td>").Append(Escape(finding.Evidence)).Append("</td><td>").Append(Escape(finding.Message)).Append("</td></tr>");
            }
            html.Append("</tbody></table></body></html>");
            File.WriteAllText(path, html.ToString(), new UTF8Encoding(true));
        }

        private static string Number(decimal? value)
        {
            return value.HasValue ? value.Value.ToString("0.############################", CultureInfo.InvariantCulture) : "";
        }

        private static string Escape(string value)
        {
            return (value ?? "").Replace("&", "&amp;").Replace("<", "&lt;").Replace(">", "&gt;").Replace("\"", "&quot;").Replace("'", "&#39;");
        }
    }
}
