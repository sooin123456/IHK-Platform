using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Lukas.Qto.Core;

namespace Lukas.Qto.Preflight
{
    internal static class Program
    {
        private static int Main(string[] args)
        {
            if (args.Length > 0 && args[0] == "--sources")
            {
                if (args.Length == 7 && args[2] == "--mapping-template")
                    return RunMappingTemplate(args[1], args[3], args[4], args[5], args[6], false);
                if (args.Length >= 8 && args.Length <= 10 && args[2] == "--ifc")
                    return RunPreflight(args[1], args[4], args[5], args[6], args[7], args.Length > 8 ? args[8] : null, args.Length > 9 ? args[9] : null, false, args[3]);
                if (args.Length >= 6 && args.Length <= 8)
                    return RunPreflight(args[1], args[2], args[3], args[4], args[5], args.Length > 6 ? args[6] : null, args.Length > 7 ? args[7] : null, false);
            }
            else if (args.Length > 0 && args[0] == "--unsafe-no-source-gate")
            {
                if (args.Length == 6 && args[1] == "--mapping-template")
                    return RunMappingTemplate(null, args[2], args[3], args[4], args[5], true);
                if (args.Length >= 5 && args.Length <= 7)
                    return RunPreflight(null, args[1], args[2], args[3], args[4], args.Length > 5 ? args[5] : null, args.Length > 6 ? args[6] : null, true);
            }
            Usage();
            return 2;
        }

        private static int RunMappingTemplate(string sourceManifest, string qtoPath, string estimatePath, string templatePath, string indexPath, bool skipSourceGate)
        {
            try
            {
                var inputs = new List<string> { qtoPath, estimatePath };
                if (!skipSourceGate) inputs.Insert(0, sourceManifest);
                RejectOutputCollision(new[] { templatePath, indexPath }, inputs.ToArray());
                string[] initialHashes = HashAll(inputs);
                SourceGateResult gate = null;
                if (!skipSourceGate)
                {
                    gate = SourceGate.RunMappingTemplateWithHashes(sourceManifest, qtoPath, estimatePath, initialHashes[1], initialHashes[2]);
                    if (!gate.Passed)
                    {
                        foreach (Finding finding in gate.Findings.Where(x => x.Status == "FAIL")) Console.Error.WriteLine(finding.Rule + ": " + finding.Message);
                        return 1;
                    }
                }
                var estimate = Input.ReadEstimate(estimatePath);
                var qto = Input.ReadQto(qtoPath);
                EnsureUnchanged(inputs, initialHashes);
                MappingTemplate.Write(templatePath, indexPath, estimate, qto);
                if (skipSourceGate) Console.Error.WriteLine("경고: 소스 게이트를 건너뛰고 매핑 템플릿을 만들었습니다.");
                Console.WriteLine("매핑 템플릿: " + templatePath + ", QTO 인덱스: " + indexPath);
                return skipSourceGate ? 3 : 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.Message);
                return 2;
            }
        }

        private static int RunPreflight(string sourceManifest, string qtoPath, string estimatePath, string mappingPath, string reportPath, string quantityTolerance, string krwTolerance, bool skipSourceGate, string ifcPath = null)
        {
            try
            {
                string manifestPath = reportPath + ".manifest.csv";
                string htmlPath = reportPath + ".html";
                var inputs = new List<string> { qtoPath, estimatePath, mappingPath };
                if (!string.IsNullOrEmpty(ifcPath)) inputs.Insert(0, ifcPath);
                if (!skipSourceGate) inputs.Insert(0, sourceManifest);
                RejectOutputCollision(new[] { reportPath, manifestPath, htmlPath }, inputs.ToArray());
                string[] initialHashes = HashAll(inputs);
                var policy = new AuditPolicy
                {
                    QuantityTolerance = quantityTolerance == null ? 0m : decimal.Parse(quantityTolerance, CultureInfo.InvariantCulture),
                    KrwTolerance = krwTolerance == null ? 0m : decimal.Parse(krwTolerance, CultureInfo.InvariantCulture)
                };
                if (policy.QuantityTolerance < 0m || policy.KrwTolerance < 0m) throw new FormatException("허용오차는 음수일 수 없습니다.");

                SourceGateResult gate = null;
                var findings = new List<Finding>();
                if (skipSourceGate)
                    findings.Add(new Finding { Rule = "S000", Status = "REVIEW", Severity = "WARNING", LineId = "SOURCE", Message = "명시적으로 소스 게이트를 건너뛴 실행입니다.", Evidence = "--unsafe-no-source-gate" });
                else
                {
                    gate = string.IsNullOrEmpty(ifcPath)
                        ? SourceGate.RunWithHashes(sourceManifest, qtoPath, estimatePath, mappingPath, initialHashes[1], initialHashes[2], initialHashes[3])
                        : SourceGate.RunProjectWithHashes(sourceManifest, ifcPath, qtoPath, estimatePath, mappingPath, initialHashes[1], initialHashes[2], initialHashes[3], initialHashes[4]);
                    findings.AddRange(gate.Findings);
                }

                if (skipSourceGate || gate.Passed)
                {
                    var estimate = Input.ReadEstimate(estimatePath);
                    findings.AddRange(Lukas.Qto.Core.Preflight.Run(Input.ReadQto(qtoPath), estimate, Input.ReadMappings(mappingPath), policy, Input.ReadEstimateSummary(estimatePath)));
                }
                EnsureUnchanged(inputs, initialHashes);

                int offset = skipSourceGate ? 0 : 1;
                int qtoOffset = offset + (string.IsNullOrEmpty(ifcPath) ? 0 : 1);
                string reportParent = Path.GetDirectoryName(Path.GetFullPath(reportPath));
                if (string.IsNullOrEmpty(reportParent)) throw new IOException("결과 폴더 경로가 없습니다.");
                Directory.CreateDirectory(reportParent);
                string staging = Path.Combine(reportParent, "." + Path.GetFileName(reportPath) + "." + Guid.NewGuid().ToString("N") + ".tmp");
                string stagedReport = Path.Combine(staging, Path.GetFileName(reportPath));
                string stagedManifest = Path.Combine(staging, Path.GetFileName(manifestPath));
                string stagedHtml = Path.Combine(staging, Path.GetFileName(htmlPath));
                var published = new List<string>();
                try
                {
                    Directory.CreateDirectory(staging);
                    Report.Write(stagedReport, findings);
                    RunManifest.Write(stagedManifest, qtoPath, estimatePath, mappingPath, policy,
                        initialHashes[qtoOffset], initialHashes[qtoOffset + 1], initialHashes[qtoOffset + 2],
                        skipSourceGate ? null : sourceManifest, skipSourceGate ? null : initialHashes[0], gate, skipSourceGate,
                        RunManifest.Hash(typeof(Program).Assembly.Location), ifcPath, string.IsNullOrEmpty(ifcPath) ? null : initialHashes[offset],
                        reportPath, RunManifest.Hash(stagedReport));
                    Report.WriteHtml(stagedHtml, findings, Path.GetFileName(manifestPath));
                    EnsureUnchanged(inputs, initialHashes);
                    RejectOutputCollision(new[] { reportPath, manifestPath, htmlPath }, inputs.ToArray());
                    Publish(stagedReport, reportPath, published);
                    Publish(stagedManifest, manifestPath, published);
                    Publish(stagedHtml, htmlPath, published);
                }
                catch
                {
                    foreach (string path in published)
                        try { File.Delete(path); } catch { }
                    throw;
                }
                finally
                {
                    try { if (Directory.Exists(staging)) Directory.Delete(staging, true); } catch { }
                }
                int failures = findings.Count(x => x.Status == "FAIL");
                Console.WriteLine("검산 결과: " + findings.Count + "건, 실패: " + failures + "건, CSV: " + reportPath + ", HTML: " + htmlPath + ", manifest: " + manifestPath);
                return failures > 0 ? 1 : skipSourceGate ? 3 : 0;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.Message);
                return 2;
            }
        }

        private static string[] HashAll(IEnumerable<string> paths)
        {
            return paths.Select(RunManifest.Hash).ToArray();
        }

        private static void EnsureUnchanged(IList<string> paths, string[] initialHashes)
        {
            if (!initialHashes.SequenceEqual(HashAll(paths), StringComparer.Ordinal)) throw new IOException("검산 중 입력 파일이 변경되었습니다. 다시 실행하십시오.");
        }

        private static void Publish(string stagedPath, string finalPath, ICollection<string> published)
        {
            bool created = false;
            try
            {
                using (var source = File.OpenRead(stagedPath))
                using (var destination = new FileStream(finalPath, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                {
                    created = true;
                    source.CopyTo(destination);
                    destination.Flush(true);
                }
                published.Add(finalPath);
                File.Delete(stagedPath);
            }
            catch
            {
                if (created)
                    try { File.Delete(finalPath); } catch { }
                throw;
            }
        }

        private static void RejectOutputCollision(string[] outputs, string[] inputs)
        {
            string[] outputPaths = outputs.Select(Path.GetFullPath).ToArray();
            if (outputPaths.Distinct(StringComparer.OrdinalIgnoreCase).Count() != outputPaths.Length) throw new IOException("결과 파일 경로는 서로 달라야 합니다.");
            if (outputPaths.Any(path => File.Exists(path) || Directory.Exists(path))) throw new IOException("기존 결과 파일을 덮어쓰지 않습니다. 다른 결과 경로를 지정하십시오.");
            var inputPaths = new HashSet<string>(inputs.Select(Path.GetFullPath), StringComparer.OrdinalIgnoreCase);
            if (outputPaths.Any(inputPaths.Contains)) throw new IOException("결과 파일 경로는 입력 파일과 같을 수 없습니다.");
            foreach (string output in outputPaths)
            {
                if (File.Exists(output) && (File.GetAttributes(output) & FileAttributes.ReparsePoint) != 0) throw new IOException("결과 파일은 심볼릭 링크일 수 없습니다: " + output);
                string parent = Path.GetDirectoryName(output);
                while (!string.IsNullOrEmpty(parent))
                {
                    if (Directory.Exists(parent) && (File.GetAttributes(parent) & FileAttributes.ReparsePoint) != 0) throw new IOException("결과 폴더 경로는 심볼릭 링크를 포함할 수 없습니다: " + parent);
                    string next = Path.GetDirectoryName(parent);
                    if (string.Equals(next, parent, StringComparison.Ordinal)) break;
                    parent = next;
                }
            }
        }

        private static void Usage()
        {
            Console.Error.WriteLine("사용법: Lukas.Qto.Preflight --sources <source-manifest.csv> <qto.csv> <estimate.csv|estimate.xlsx> <mapping.csv> <report.csv> [수량허용오차] [KRW허용오차]\n" +
                "   또는: Lukas.Qto.Preflight --sources <source-manifest.csv> --ifc <model.ifc> <qto.csv> <estimate.csv|estimate.xlsx> <mapping.csv> <report.csv> [수량허용오차] [KRW허용오차]\n" +
                "   또는: Lukas.Qto.Preflight --sources <source-manifest.csv> --mapping-template <qto.csv> <estimate.csv|estimate.xlsx> <template.xlsx> <qto-index.xlsx>\n" +
                "검증되지 않은 입력은 첫 옵션을 --unsafe-no-source-gate로 바꿔 명시적으로만 실행할 수 있습니다.");
        }
    }
}
