using Lukas.Qto.Desktop;
using Lukas.Qto.Core;

static void Assert(bool condition, string message)
{
    if (!condition) throw new InvalidOperationException("Desktop self-test failed: " + message);
}

static string FindRepoRoot()
{
    var directory = new DirectoryInfo(AppContext.BaseDirectory);
    while (directory != null && !File.Exists(Path.Combine(directory.FullName, "samples", "source-manifest.csv"))) directory = directory.Parent;
    return directory?.FullName ?? throw new DirectoryNotFoundException("Repository root not found.");
}

static string Semantic(Finding value) => string.Join("\u001f", value.Rule, value.Status, value.Severity, value.LineId,
    value.QtoId, value.Unit, value.Expected, value.Actual, value.Delta, value.Evidence, value.Message);
static string H(char value) => new string(value, 64);

string root = FindRepoRoot();
string samples = Path.Combine(root, "samples");
string temp = Path.Combine(Path.GetTempPath(), "lukas-qto-desktop-" + Guid.NewGuid().ToString("N"));
Directory.CreateDirectory(temp);
try
{
    string MakeExportPackage(string name, string status)
    {
        string folder = Path.Combine(temp, name);
        Directory.CreateDirectory(folder);
        string packageIfc = Path.Combine(folder, "model.ifc");
        string packageQto = Path.Combine(folder, "qto.csv");
        string packageLedger = Path.Combine(folder, "element-ledger.csv");
        File.Copy(Path.Combine(samples, "sample.ifc"), packageIfc);
        File.Copy(Path.Combine(samples, "qto.csv"), packageQto);
        var qtoRecords = Input.ReadQto(packageQto);
        ElementQuantityLedger.Write(packageLedger, qtoRecords.SelectMany(row => row.ElementIds).Select(id => new ElementQuantityLedgerRow {
            ElementId = id, Category = "Walls", Family = "Basic Wall", Type = "Generic", Level = "L1",
            VolumeState = ElementVolumeState.COMPUTED, VolumeM3 = 1m, SourceParameter = "HOST_VOLUME_COMPUTED"
        }));
        string manifest = Path.Combine(folder, "export-manifest.csv");
        Csv.Write(manifest, new[]
        {
            new[] { "product_version", "exported_at_utc", "revit_version", "document_title", "ifc_configuration", "ifc_file", "ifc_sha256", "qto_file", "qto_sha256", "qto_row_count", "element_count", "element_ledger_file", "element_ledger_sha256", "element_ledger_row_count", "status", "failure_reason" },
            new[] { "1.0.0", "2026-01-01T00:00:00.0000000Z", "2026", "sample", "default", "model.ifc", RunManifest.Hash(packageIfc), "qto.csv", RunManifest.Hash(packageQto), qtoRecords.Count.ToString(), qtoRecords.SelectMany(row => row.ElementIds).Count().ToString(), "element-ledger.csv", RunManifest.Hash(packageLedger), qtoRecords.SelectMany(row => row.ElementIds).Count().ToString(), status, status == "COMPLETE" ? "" : "test failure" }
        });
        return manifest;
    }

    void AssertProjectRejected(Action action, string outputDirectory, string message)
    {
        bool rejected = false;
        try { action(); }
        catch (Exception ex) when (ex is IOException or InvalidDataException or FormatException) { rejected = true; }
        Assert(rejected, message);
        Assert(!Directory.Exists(outputDirectory) && !Directory.Exists(outputDirectory + ".partial"), message + " leaves no project or partial manifest");
    }

    string sourceManifest = Path.Combine(samples, "source-manifest.csv");
    string qto = Path.Combine(samples, "qto.csv");
    string estimate = Path.Combine(samples, "estimate.csv");
    string mapping = Path.Combine(samples, "mapping.csv");
    var result = DesktopPreflightRunner.Run(new DesktopPreflightRequest
    {
        SourceManifestPath = sourceManifest, QtoPath = qto, EstimatePath = estimate, MappingPath = mapping,
        ReportPath = Path.Combine(temp, "valid-report.csv")
    });
    Assert(result.SourceGatePassed, "approved sample passes the source gate");
    var gate = SourceGate.Run(sourceManifest, qto, estimate, mapping);
    var expected = gate.Findings.Concat(Preflight.Run(Input.ReadQto(qto), Input.ReadEstimate(estimate), Input.ReadMappings(mapping), new AuditPolicy(), Input.ReadEstimateSummary(estimate))).Select(Semantic);
    Assert(result.Findings.Select(Semantic).SequenceEqual(expected), "desktop findings are semantically identical to direct Core execution");
    Assert(File.Exists(result.ReportPath) && File.Exists(result.HtmlPath) && File.Exists(result.ManifestPath), "CSV, HTML, and manifest outputs exist");
    var resultManifest = Csv.Read(result.ManifestPath);
    string reportHash = resultManifest.Single(x => x[0] == "결과_CSV_SHA256")[1];
    Assert(resultManifest.Single(x => x[0] == "결과_CSV_파일")[1] == Path.GetFileName(result.ReportPath) &&
           reportHash.Length == 64 && reportHash == RunManifest.Hash(result.ReportPath), "desktop manifest binds the report filename and SHA-256");
    string reportCopy = Path.Combine(temp, "tampered-report.csv");
    File.Copy(result.ReportPath, reportCopy);
    File.AppendAllText(reportCopy, Environment.NewLine + "tampered");
    Assert(reportHash != RunManifest.Hash(reportCopy), "report tampering is detectable from the manifest hash");
    Assert(result.Findings.All(x => x.Rule != "S006") && Csv.Read(result.ManifestPath).All(x => x[0] != "IFC_파일" && x[0] != "IFC_SHA256"), "omitted IFC preserves the existing three-slot run");

    string ifc = Path.Combine(samples, "sample.ifc");
    var projectResult = DesktopPreflightRunner.Run(new DesktopPreflightRequest
    {
        SourceManifestPath = sourceManifest, IfcPath = ifc, QtoPath = qto, EstimatePath = estimate, MappingPath = mapping,
        ReportPath = Path.Combine(temp, "ifc-project-report.csv")
    });
    Assert(projectResult.SourceGatePassed && projectResult.Findings.Any(x => x.Rule == "S006" && x.Status == "PASS"), "approved IFC project passes S006");
    var projectManifest = Csv.Read(projectResult.ManifestPath);
    Assert(projectManifest.Any(x => x[0] == "IFC_파일" && x[1] == "sample.ifc") &&
           projectManifest.Any(x => x[0] == "IFC_SHA256" && x[1] == RunManifest.Hash(ifc)) &&
           projectManifest.Any(x => x[0] == "IFC_소스_ID" && x[1] == "sample-ifc-r1"), "run manifest records IFC file, hash, and source ID");

    string altered = Path.Combine(temp, "altered");
    Directory.CreateDirectory(altered);
    foreach (string file in new[] { "source-manifest.csv", "sample.ifc", "qto.csv", "estimate.csv", "mapping.csv" })
        File.Copy(Path.Combine(samples, file), Path.Combine(altered, file));
    File.AppendAllText(Path.Combine(altered, "qto.csv"), Environment.NewLine);
    var blocked = DesktopPreflightRunner.Run(new DesktopPreflightRequest
    {
        SourceManifestPath = Path.Combine(altered, "source-manifest.csv"), QtoPath = Path.Combine(altered, "qto.csv"),
        EstimatePath = Path.Combine(altered, "estimate.csv"), MappingPath = Path.Combine(altered, "mapping.csv"),
        ReportPath = Path.Combine(temp, "blocked-report.csv")
    });
    Assert(!blocked.SourceGatePassed, "changed QTO fails the source gate");
    Assert(blocked.Findings.All(x => x.Rule.StartsWith("S", StringComparison.Ordinal)), "source-gate failure blocks every R rule");
    Assert(blocked.Findings.Any(x => x.Status == "FAIL") && blocked.Findings.Any(x => x.Status == "NOT_EVALUATED"), "failure and not-evaluated findings remain visible");
    Assert(File.Exists(blocked.ReportPath) && File.Exists(blocked.HtmlPath) && File.Exists(blocked.ManifestPath), "blocked run still writes audit outputs");

    string collisionReport = Path.Combine(temp, "atomic-collision.csv");
    string collisionManifest = collisionReport + ".manifest.csv";
    File.WriteAllText(collisionManifest, "keep");
    bool reportCollisionRejected = false;
    try
    {
        DesktopPreflightRunner.Run(new DesktopPreflightRequest
        {
            SourceManifestPath = sourceManifest, QtoPath = qto, EstimatePath = estimate, MappingPath = mapping,
            ReportPath = collisionReport
        });
    }
    catch (IOException) { reportCollisionRejected = true; }
    Assert(reportCollisionRejected && File.ReadAllText(collisionManifest) == "keep", "existing desktop output is never overwritten");
    Assert(!File.Exists(collisionReport) && !File.Exists(collisionReport + ".html"), "output collision leaves no partial report bundle");
    Assert(Directory.GetDirectories(temp, ".atomic-collision.csv.*.tmp").Length == 0, "output collision leaves no staging directory");

    File.Copy(qto, Path.Combine(altered, "qto.csv"), true);
    string invalidProvenance = Path.Combine(altered, "invalid-provenance.csv");
    var invalidRows = Csv.Read(Path.Combine(altered, "source-manifest.csv"));
    invalidRows.Single(x => x[0] == "sample-qto-r1")[7] = "";
    Csv.Write(invalidProvenance, invalidRows);
    var provenanceBlocked = DesktopPreflightRunner.Run(new DesktopPreflightRequest
    {
        SourceManifestPath = invalidProvenance, IfcPath = Path.Combine(altered, "sample.ifc"), QtoPath = Path.Combine(altered, "qto.csv"),
        EstimatePath = Path.Combine(altered, "estimate.csv"), MappingPath = Path.Combine(altered, "mapping.csv"),
        ReportPath = Path.Combine(temp, "provenance-blocked-report.csv")
    });
    Assert(!provenanceBlocked.SourceGatePassed && provenanceBlocked.Findings.Any(x => x.Rule == "S006" && x.Status == "FAIL"), "invalid IFC-QTO provenance fails S006");
    Assert(provenanceBlocked.Findings.All(x => x.Rule.StartsWith("S", StringComparison.Ordinal)), "S006 failure blocks every R rule");

    string exportManifest = MakeExportPackage("complete-export", "COMPLETE");
    string projectDirectory = Path.Combine(temp, "created-project");
    ProjectCreationResult created = ProjectManifestBuilder.Create(exportManifest, estimate, mapping, projectDirectory);
    Assert(Directory.Exists(projectDirectory) && File.Exists(created.SourceManifestPath) && File.Exists(created.ElementLedgerPath), "COMPLETE Revit package creates an atomic project folder with element ledger");
    SourceGateResult createdGate = SourceGate.RunProject(created.SourceManifestPath, created.IfcPath, created.QtoPath, created.EstimatePath, created.MappingPath);
    Assert(createdGate.Passed && createdGate.Findings.Any(x => x.Rule == "S006" && x.Status == "PASS"), "created four-slot project passes S006");
    var createdRows = Csv.Read(created.SourceManifestPath);
    string[] ifcRow = createdRows.Single(x => x.Length > 3 && x[3] == "ifc");
    string[] qtoRow = createdRows.Single(x => x.Length > 3 && x[3] == "qto");
    Assert(createdRows.Skip(1).All(x => x[4] == ifcRow[4] && x[5] == "1" && x[6] == "ACTIVE") && qtoRow[7] == ifcRow[0], "all slots share scope/revision ACTIVE and QTO points to IFC");
    Assert(RunManifest.Hash(Path.Combine(projectDirectory, "export-manifest.csv")) == RunManifest.Hash(exportManifest), "project preserves the verified export manifest");

    var concreteMapBundle = new RevitConcreteMappingBundle { BundleId = "desktop-revit-map", Version = "1", SourceRef = "approved-map.csv!A2" };
    concreteMapBundle.Rules.Add(new RevitConcreteMappingRule { Category = "Walls", Family = "Basic Wall", Type = "Generic", Building = "A", Member = "Wall", Spec = "25-270-15" });
    concreteMapBundle.Sha256 = ConcreteTakeoff.ComputeRevitMappingHash(concreteMapBundle);
    var concreteRuleBundle = new ConcreteRuleBundle { BundleId = "desktop-concrete-rule", Version = "1", SourceRef = "approved-rules.csv!A2" };
    concreteRuleBundle.Rules.Add(new ConcreteAllowanceRule { Spec = "25-270-15", AllowanceRate = 0m, ApplicationBasis = ConcreteAllowanceBasis.Subtotal, DeductionTiming = ConcreteDeductionTiming.BeforeAllowance, RoundingMode = StructuralRoundingMode.None });
    concreteRuleBundle.Sha256 = ConcreteTakeoff.ComputeRuleHash(concreteRuleBundle);
    string concreteMapCsv = Path.Combine(temp, "approved-revit-map.csv");
    string concreteRulesCsv = Path.Combine(temp, "approved-concrete-rules.csv");
    string concreteRegistryCsv = Path.Combine(temp, "approved-concrete-registry.csv");
    Csv.Write(concreteMapCsv, new[] { new[] { "bundle_id", "version", "bundle_sha256", "source_ref", "category", "family", "type", "decision", "building", "member", "spec" }, new[] { concreteMapBundle.BundleId, concreteMapBundle.Version, concreteMapBundle.Sha256, concreteMapBundle.SourceRef, "Walls", "Basic Wall", "Generic", "Include", "A", "Wall", "25-270-15" } });
    Csv.Write(concreteRulesCsv, new[] { new[] { "bundle_id", "version", "bundle_sha256", "source_ref", "spec", "allowance_rate", "application_basis", "deduction_timing", "rounding_mode", "rounding_scale" }, new[] { concreteRuleBundle.BundleId, concreteRuleBundle.Version, concreteRuleBundle.Sha256, concreteRuleBundle.SourceRef, "25-270-15", "0", "Subtotal", "BeforeAllowance", "None", "" } });
    Csv.Write(concreteRegistryCsv, new[] { new[] { "kind", "bundle_id", "version", "sha256" }, new[] { "revit_mapping", concreteMapBundle.BundleId, concreteMapBundle.Version, concreteMapBundle.Sha256 }, new[] { "concrete_rules", concreteRuleBundle.BundleId, concreteRuleBundle.Version, concreteRuleBundle.Sha256 } });
    string concreteReport = Path.Combine(temp, "desktop-concrete.csv");
    DesktopConcreteTakeoffResult desktopConcrete = DesktopConcreteTakeoffRunner.Run(new DesktopConcreteTakeoffRequest { ExportManifestPath = Path.Combine(projectDirectory, "export-manifest.csv"), ElementLedgerPath = created.ElementLedgerPath, RevitMappingPath = concreteMapCsv, ConcreteRulesPath = concreteRulesCsv, RegistryPath = concreteRegistryCsv, ReportPath = concreteReport });
    Assert(desktopConcrete.Status == StructuralQuantityStatus.REVIEW && desktopConcrete.Mapping.ComputedSelectedCount == 2 && desktopConcrete.Takeoff.Status == StructuralQuantityStatus.REVIEW && File.Exists(concreteReport) && TakeoffReport.Verify(concreteReport).ReportSha256 == RunManifest.Hash(concreteReport),
        "desktop concrete runner calculates the bound package but does not call a user-selected registry an operational approval");
    string tamperedConcreteMap = Path.Combine(temp, "tampered-revit-map.csv");
    File.Copy(concreteMapCsv, tamperedConcreteMap); File.AppendAllText(tamperedConcreteMap, Environment.NewLine);
    bool tamperedConcreteRejected = false;
    try { DesktopConcreteTakeoffRunner.Run(new DesktopConcreteTakeoffRequest { ExportManifestPath = Path.Combine(projectDirectory, "export-manifest.csv"), ElementLedgerPath = created.ElementLedgerPath, RevitMappingPath = tamperedConcreteMap, ConcreteRulesPath = concreteRulesCsv, RegistryPath = concreteRegistryCsv, ReportPath = Path.Combine(temp, "tampered-concrete.csv") }); }
    catch (InvalidDataException) { tamperedConcreteRejected = true; }
    Assert(tamperedConcreteRejected, "tampered approved mapping CSV is rejected before report publication");
    string unapprovedRegistry = Path.Combine(temp, "unapproved-concrete-registry.csv");
    Csv.Write(unapprovedRegistry, new[] { new[] { "kind", "bundle_id", "version", "sha256" }, new[] { "concrete_rules", concreteRuleBundle.BundleId, concreteRuleBundle.Version, concreteRuleBundle.Sha256 } });
    DesktopConcreteTakeoffResult unapprovedConcrete = DesktopConcreteTakeoffRunner.Run(new DesktopConcreteTakeoffRequest { ExportManifestPath = Path.Combine(projectDirectory, "export-manifest.csv"), ElementLedgerPath = created.ElementLedgerPath, RevitMappingPath = concreteMapCsv, ConcreteRulesPath = concreteRulesCsv, RegistryPath = unapprovedRegistry, ReportPath = Path.Combine(temp, "unapproved-concrete.csv") });
    Assert(unapprovedConcrete.Status == StructuralQuantityStatus.REVIEW && unapprovedConcrete.Mapping.Rows.Count == 0, "unapproved Revit mapping is review without inferred rows");
    string missingExport = MakeExportPackage("missing-concrete-export", "COMPLETE");
    string missingLedger = Path.Combine(Path.GetDirectoryName(missingExport)!, "element-ledger.csv");
    var missingRows = ElementQuantityLedger.Read(missingLedger).Select(row => new ElementQuantityLedgerRow { ElementId = row.ElementId, Category = row.Category, Family = row.Family, Type = row.Type, Level = row.Level, VolumeState = row.ElementId == "1002" ? ElementVolumeState.MISSING : row.VolumeState, VolumeM3 = row.ElementId == "1002" ? null : row.VolumeM3, SourceParameter = row.ElementId == "1002" ? "" : row.SourceParameter }).ToList();
    File.Delete(missingLedger); ElementQuantityLedger.Write(missingLedger, missingRows);
    var missingManifestRows = Csv.Read(missingExport); missingManifestRows[1][12] = RunManifest.Hash(missingLedger); Csv.Write(missingExport, missingManifestRows);
    DesktopConcreteTakeoffResult missingConcrete = DesktopConcreteTakeoffRunner.Run(new DesktopConcreteTakeoffRequest { ExportManifestPath = missingExport, ElementLedgerPath = missingLedger, RevitMappingPath = concreteMapCsv, ConcreteRulesPath = concreteRulesCsv, RegistryPath = concreteRegistryCsv, ReportPath = Path.Combine(temp, "missing-concrete.csv") });
    Assert(missingConcrete.Status == StructuralQuantityStatus.REVIEW && missingConcrete.Mapping.MissingReviewCount == 1 && missingConcrete.Mapping.Rows.Count == 1, "MISSING element ledger row is carried as review rather than inferred");
    string zeroExport = MakeExportPackage("zero-concrete-export", "COMPLETE");
    string zeroLedger = Path.Combine(Path.GetDirectoryName(zeroExport)!, "element-ledger.csv");
    var zeroRows = ElementQuantityLedger.Read(zeroLedger).Select(row => new ElementQuantityLedgerRow { ElementId = row.ElementId, Category = row.Category, Family = row.Family, Type = row.Type, Level = row.Level, VolumeState = ElementVolumeState.ZERO, VolumeM3 = 0m, SourceParameter = "HOST_VOLUME_COMPUTED" }).ToList();
    File.Delete(zeroLedger); ElementQuantityLedger.Write(zeroLedger, zeroRows);
    var zeroManifestRows = Csv.Read(zeroExport); zeroManifestRows[1][12] = RunManifest.Hash(zeroLedger); Csv.Write(zeroExport, zeroManifestRows);
    DesktopConcreteTakeoffResult zeroConcrete = DesktopConcreteTakeoffRunner.Run(new DesktopConcreteTakeoffRequest { ExportManifestPath = zeroExport, ElementLedgerPath = zeroLedger, RevitMappingPath = concreteMapCsv, ConcreteRulesPath = concreteRulesCsv, RegistryPath = concreteRegistryCsv, ReportPath = Path.Combine(temp, "zero-concrete.csv") });
    Assert(zeroConcrete.Status == StructuralQuantityStatus.REVIEW && zeroConcrete.Mapping.ZeroExcludedCount == 2 && zeroConcrete.Takeoff.Rows.Count == 0 &&
        TakeoffReport.Verify(zeroConcrete.Artifact.ReportPath).ReportSha256 == RunManifest.Hash(zeroConcrete.Artifact.ReportPath),
        "empty selected concrete result is a verifiable summary, not an estimate");

    var rb = new RebarRuleBundle { BundleId = "rb", Version = "1", Evidence = new StructuralRuleEvidence { RuleId = "rb-rule", SourceRef = "rules.csv!A2" }, ApprovedToleranceKg = 0m, ToleranceSource = new StructuralSourceEvidence { SourceId = "tol", Sha256 = H('b'), Revision = "1", Sheet = "s", Cell = "A1" } };
    rb.Specifications.Add(new RebarSpecificationRule { Spec = "H10", UnitMassKgPerM = 1m, UnitMassSource = new StructuralSourceEvidence { SourceId = "unit", Sha256 = H('c'), Revision = "1", Sheet = "s", Cell = "A2" }, LossRate = 0m, LossSource = new StructuralSourceEvidence { SourceId = "loss", Sha256 = H('d'), Revision = "1", Sheet = "s", Cell = "A3" }, RoundingStage = RebarRoundingStage.Specification, RoundingMode = StructuralRoundingMode.None, RoundingScale = 0, RoundingSource = new StructuralSourceEvidence { SourceId = "round", Sha256 = H('e'), Revision = "1", Sheet = "s", Cell = "A4" } });
    rb.Evidence.Sha256 = RebarTakeoff.ComputeRuleHash(rb);
    string rbLength = Path.Combine(temp, "rb-length.csv"), rbRules = Path.Combine(temp, "rb-rules.csv"), rbOfficial = Path.Combine(temp, "rb-official.csv"), rbRegistry = Path.Combine(temp, "rb-registry.csv");
    Csv.Write(rbLength, new[] { new[] { "row_id", "spec", "signed_length_m", "source_id", "source_sha256", "revision", "sheet", "cell", "included_components" }, new[] { "L1", "H10", "10", "raw", H('a'), "1", "s", "A1", "None" } });
    Csv.Write(rbRules, new[] { new[] { "bundle_id", "version", "bundle_sha256", "bundle_rule_id", "bundle_source_ref", "approved_tolerance_kg", "tolerance_source_id", "tolerance_source_sha256", "tolerance_revision", "tolerance_sheet", "tolerance_cell", "spec", "unit_mass_kg_per_m", "unit_mass_source_id", "unit_mass_source_sha256", "unit_mass_revision", "unit_mass_sheet", "unit_mass_cell", "loss_rate", "loss_source_id", "loss_source_sha256", "loss_revision", "loss_sheet", "loss_cell", "rounding_stage", "rounding_mode", "rounding_scale", "rounding_source_id", "rounding_source_sha256", "rounding_revision", "rounding_sheet", "rounding_cell" }, new[] { "rb", "1", rb.Evidence.Sha256, "rb-rule", "rules.csv!A2", "0", "tol", H('b'), "1", "s", "A1", "H10", "1", "unit", H('c'), "1", "s", "A2", "0", "loss", H('d'), "1", "s", "A3", "Specification", "None", "0", "round", H('e'), "1", "s", "A4" } });
    Csv.Write(rbOfficial, new[] { new[] { "mass_kg", "source_id", "source_sha256", "revision", "sheet", "cell" }, new[] { "10", "official", H('f'), "1", "o", "B1" } });
    Csv.Write(rbRegistry, new[] { new[] { "kind", "id", "sha256" }, new[] { "source", "raw", H('a') }, new[] { "source", "tol", H('b') }, new[] { "source", "unit", H('c') }, new[] { "source", "loss", H('d') }, new[] { "source", "round", H('e') }, new[] { "source", "official", H('f') }, new[] { "rule", "rb-rule", rb.Evidence.Sha256 } });
    string rbReport = Path.Combine(temp, "rb-report.csv");
    DesktopRebarTakeoffResult rbPass = DesktopRebarTakeoffRunner.Run(new DesktopRebarTakeoffRequest { LengthLedgerPath = rbLength, RuleBundlePath = rbRules, OfficialTargetPath = rbOfficial, RegistryPath = rbRegistry, ReportPath = rbReport });
    Assert(rbPass.Takeoff.Status == StructuralQuantityStatus.REVIEW && RebarTakeoffReport.Verify(rbReport).ReportSha256 == RunManifest.Hash(rbReport),
        "synthetic rebar runner verifies the calculation but local self-issued registry remains review");
    DesktopRebarTakeoffResult rbNoOfficial = DesktopRebarTakeoffRunner.Run(new DesktopRebarTakeoffRequest { LengthLedgerPath = rbLength, RuleBundlePath = rbRules, RegistryPath = rbRegistry, ReportPath = Path.Combine(temp, "rb-no-official.csv") });
    Assert(rbNoOfficial.Takeoff.Status == StructuralQuantityStatus.NOT_EVALUATED, "rebar runner requires independent official target");
    File.AppendAllText(rbReport, Environment.NewLine + "tampered"); bool rbTampered = false; try { RebarTakeoffReport.Verify(rbReport); } catch (InvalidDataException) { rbTampered = true; } Assert(rbTampered, "rebar report tampering is detected");

    string concreteDemo = Path.Combine(samples, "concrete-demo");
    DesktopConcreteTakeoffResult concreteDemoResult = DesktopConcreteTakeoffRunner.Run(new DesktopConcreteTakeoffRequest {
        ExportManifestPath = Path.Combine(concreteDemo, "export-manifest.csv"), ElementLedgerPath = Path.Combine(concreteDemo, "element-ledger.csv"),
        RevitMappingPath = Path.Combine(concreteDemo, "concrete-mapping.csv"), ConcreteRulesPath = Path.Combine(concreteDemo, "concrete-rules.csv"),
        RegistryPath = Path.Combine(concreteDemo, "concrete-registry.csv"), ReportPath = Path.Combine(temp, "concrete-demo-result.csv")
    });
    Assert(concreteDemoResult.Status == StructuralQuantityStatus.REVIEW && concreteDemoResult.Takeoff.Rows.Single().RawQuantityM3 == 10m &&
        concreteDemoResult.Takeoff.Rows.Single().FinalQuantityM3 == 10m, "repository concrete demo runs end-to-end with 10 m3 and no implicit allowance");

    string revisionEstimate = Path.Combine(temp, "estimate-r2-outside.csv");
    string revisionMapping = Path.Combine(temp, "mapping-r2-outside.csv");
    File.Copy(estimate, revisionEstimate);
    File.AppendAllText(revisionEstimate, Environment.NewLine);
    File.Copy(mapping, revisionMapping);
    File.AppendAllText(revisionMapping, Environment.NewLine);
    string originalCreatedManifestHash = RunManifest.Hash(created.SourceManifestPath);
    var originalCreatedRows = Csv.Read(created.SourceManifestPath).Select(x => x.ToArray()).ToList();
    string estimateHash = RunManifest.Hash(revisionEstimate);
    string collisionName = "estimate-r2-" + estimateHash[..12].ToLowerInvariant() + ".csv";
    string collisionPath = Path.Combine(projectDirectory, collisionName);
    File.WriteAllText(collisionPath, "keep");
    RevisionRegistrationResult estimateRevision = RevisionRegistration.Register(new RevisionRegistrationRequest
    {
        SourceManifestPath = created.SourceManifestPath,
        CurrentActivePath = created.EstimatePath,
        ReplacementPath = revisionEstimate,
        Slot = "estimate"
    });
    Assert(File.ReadAllText(collisionPath) == "keep" && estimateRevision.RegisteredFilePath != collisionPath,
        "revision registration generates a collision-free project filename without overwriting an existing file");
    Assert(File.Exists(estimateRevision.SourceManifestPath) && estimateRevision.SourceManifestPath != created.SourceManifestPath &&
           RunManifest.Hash(created.SourceManifestPath) == originalCreatedManifestHash,
        "revision registration preserves the selected source manifest and publishes a new manifest");
    var estimateRevisionRows = Csv.Read(estimateRevision.SourceManifestPath);
    string[] oldEstimate = estimateRevisionRows.Single(x => x[0] == "pkg-" + RunManifest.Hash(created.IfcPath)[..16].ToLowerInvariant() + "-estimate-r1");
    string[] newEstimate = estimateRevisionRows.Single(x => x[0] == estimateRevision.SourceId);
    Assert(oldEstimate[6] == "SUPERSEDED" && oldEstimate[7] == estimateRevision.SourceId &&
           newEstimate[3] == "estimate" && newEstimate[4] == oldEstimate[4] && newEstimate[5] == "2" && newEstimate[6] == "ACTIVE" &&
           string.Equals(newEstimate[2], RunManifest.Hash(estimateRevision.RegisteredFilePath), StringComparison.OrdinalIgnoreCase),
        "estimate r1 is superseded by an exact-hash r2 ACTIVE source in the same scope");
    Assert(originalCreatedRows.Where(x => x.Length == 8 && x[3] is "ifc" or "qto" or "mapping").All(oldRow =>
        estimateRevisionRows.Any(newRow => newRow.SequenceEqual(oldRow))), "nonselected IFC, QTO, and mapping rows are preserved exactly");
    SourceGateResult estimateRevisionGate = SourceGate.RunProject(estimateRevision.SourceManifestPath, created.IfcPath, created.QtoPath,
        estimateRevision.RegisteredFilePath, created.MappingPath);
    Assert(estimateRevisionGate.Passed, "new estimate revision is the selectable ACTIVE source and passes the project source gate");

    RevisionRegistrationResult mappingRevision = RevisionRegistration.Register(new RevisionRegistrationRequest
    {
        SourceManifestPath = estimateRevision.SourceManifestPath,
        CurrentActivePath = created.MappingPath,
        ReplacementPath = revisionMapping,
        Slot = "mapping"
    });
    var mappingRevisionRows = Csv.Read(mappingRevision.SourceManifestPath);
    string[] oldMapping = mappingRevisionRows.Single(x => x[0].EndsWith("-mapping-r1", StringComparison.Ordinal));
    string[] newMapping = mappingRevisionRows.Single(x => x[0] == mappingRevision.SourceId);
    Assert(oldMapping[6] == "SUPERSEDED" && oldMapping[7] == mappingRevision.SourceId && newMapping[5] == "2" && newMapping[6] == "ACTIVE",
        "mapping r1 is superseded by r2 ACTIVE in a separately preserved manifest");
    SourceGateResult mappingRevisionGate = SourceGate.RunProject(mappingRevision.SourceManifestPath, created.IfcPath, created.QtoPath,
        estimateRevision.RegisteredFilePath, mappingRevision.RegisteredFilePath);
    Assert(mappingRevisionGate.Passed && mappingRevisionGate.Findings.Any(x => x.Rule == "S006" && x.Status == "PASS"),
        "new estimate and mapping selections preserve IFC-QTO provenance and pass the project gate");

    bool missingRevisionRejected = false;
    try
    {
        RevisionRegistration.Register(new RevisionRegistrationRequest
        {
            SourceManifestPath = mappingRevision.SourceManifestPath, CurrentActivePath = estimateRevision.RegisteredFilePath,
            ReplacementPath = Path.Combine(temp, "does-not-exist.csv"), Slot = "estimate"
        });
    }
    catch (FileNotFoundException) { missingRevisionRejected = true; }
    Assert(missingRevisionRejected, "missing revision input is rejected before any project write");
    File.AppendAllText(mappingRevision.RegisteredFilePath, Environment.NewLine);
    SourceGateResult tamperedRevisionGate = SourceGate.RunProject(mappingRevision.SourceManifestPath, created.IfcPath, created.QtoPath,
        estimateRevision.RegisteredFilePath, mappingRevision.RegisteredFilePath);
    Assert(!tamperedRevisionGate.Passed && tamperedRevisionGate.Findings.Any(x => x.Rule == "S001" && x.Status == "FAIL"),
        "tampering a registered revision is detected and blocks the project gate without overwriting prior manifests");

    string tamperedIfcManifest = MakeExportPackage("tampered-ifc-export", "COMPLETE");
    File.AppendAllText(Path.Combine(Path.GetDirectoryName(tamperedIfcManifest)!, "model.ifc"), "tampered");
    string tamperedIfcOutput = Path.Combine(temp, "tampered-ifc-project");
    AssertProjectRejected(() => ProjectManifestBuilder.Create(tamperedIfcManifest, estimate, mapping, tamperedIfcOutput), tamperedIfcOutput, "tampered IFC is rejected");

    string tamperedQtoManifest = MakeExportPackage("tampered-qto-export", "COMPLETE");
    File.AppendAllText(Path.Combine(Path.GetDirectoryName(tamperedQtoManifest)!, "qto.csv"), Environment.NewLine);
    string tamperedQtoOutput = Path.Combine(temp, "tampered-qto-project");
    AssertProjectRejected(() => ProjectManifestBuilder.Create(tamperedQtoManifest, estimate, mapping, tamperedQtoOutput), tamperedQtoOutput, "tampered QTO is rejected");

    string tamperedLedgerManifest = MakeExportPackage("tampered-ledger-export", "COMPLETE");
    File.AppendAllText(Path.Combine(Path.GetDirectoryName(tamperedLedgerManifest)!, "element-ledger.csv"), Environment.NewLine);
    string tamperedLedgerOutput = Path.Combine(temp, "tampered-ledger-project");
    AssertProjectRejected(() => ProjectManifestBuilder.Create(tamperedLedgerManifest, estimate, mapping, tamperedLedgerOutput), tamperedLedgerOutput,
        "tampered element ledger is rejected");

    string failedExport = MakeExportPackage("failed-export", "FAILED");
    string failedOutput = Path.Combine(temp, "failed-project");
    AssertProjectRejected(() => ProjectManifestBuilder.Create(failedExport, estimate, mapping, failedOutput), failedOutput, "FAILED export manifest is rejected");

    string collisionExport = MakeExportPackage("collision-export", "COMPLETE");
    string collisionOutput = Path.Combine(temp, "existing-project");
    Directory.CreateDirectory(collisionOutput);
    bool collisionRejected = false;
    try { ProjectManifestBuilder.Create(collisionExport, estimate, mapping, collisionOutput); }
    catch (IOException) { collisionRejected = true; }
    Assert(collisionRejected && Directory.Exists(collisionOutput), "existing project is never overwritten");

    string foreignPartial = Path.Combine(temp, "foreign-project.partial");
    Directory.CreateDirectory(foreignPartial);
    File.WriteAllText(Path.Combine(foreignPartial, "sentinel"), "keep");
    string foreignExport = MakeExportPackage("foreign-export", "COMPLETE");
    string foreignOutput = Path.Combine(temp, "foreign-project");
    ProjectManifestBuilder.Create(foreignExport, estimate, mapping, foreignOutput);
    Assert(File.ReadAllText(Path.Combine(foreignPartial, "sentinel")) == "keep", "project creation never deletes another instance's staging folder");
    Assert(Directory.GetDirectories(temp, "foreign-project.*.partial").Length == 0, "owned unique staging folder is removed after publish");

    string[] reportHeader = { "규칙", "상태", "심각도", "내역ID", "검산키", "단위", "기대값", "실제값", "차이", "근거", "설명" };
    string[] FindingRow(string rule, string status, string lineId, string qtoId, string unit) =>
        new[] { rule, status, status == "FAIL" ? "ERROR" : "INFO", lineId, qtoId, unit, "1", "1", "0", "test", "test" };
    void WriteComparisonManifest(string path, string reportPath, string ruleset = "L1.4.3", string quantityTolerance = "0", string krwTolerance = "0", string scope = "scope-1", string sourceGate = "PASS") => Csv.Write(path, new[]
    {
        new[] { "키", "값" }, new[] { "규칙버전", ruleset }, new[] { "수량허용오차", quantityTolerance }, new[] { "KRW허용오차", krwTolerance },
        new[] { "공사범위_ID", scope }, new[] { "소스게이트", sourceGate },
        new[] { "결과_CSV_파일", Csv.SpreadsheetText(Path.GetFileName(reportPath)) }, new[] { "결과_CSV_SHA256", RunManifest.Hash(reportPath) }
    });

    string previousReport = Path.Combine(temp, "previous.csv");
    string currentReport = Path.Combine(temp, "current.csv");
    string previousRunManifest = previousReport + ".manifest.csv";
    string currentRunManifest = currentReport + ".manifest.csv";
    Csv.Write(previousReport, new[]
    {
        reportHeader,
        FindingRow("R011", "FAIL", "amount-resolved", "", "KRW"),
        FindingRow("R021", "FAIL", "quantity-still-bad", "q-1", "m3"),
        FindingRow("R010", "PASS", "removed", "", "KRW")
    });
    Csv.Write(currentReport, new[]
    {
        reportHeader,
        FindingRow("R011", "PASS", "amount-resolved", "", "KRW"),
        FindingRow("R021", "FAIL", "quantity-still-bad", "q-1", "m3"),
        FindingRow("R020", "FAIL", "=new-unsafe", "q-2", "m2")
    });
    WriteComparisonManifest(previousRunManifest, previousReport);
    WriteComparisonManifest(currentRunManifest, currentReport);
    string comparisonOutput = Path.Combine(temp, "comparison.csv");
    RunComparisonResult comparison = RunComparer.Compare(new RunComparisonRequest
    {
        PreviousReportPath = previousReport, PreviousManifestPath = previousRunManifest,
        CurrentReportPath = currentReport, CurrentManifestPath = currentRunManifest, OutputPath = comparisonOutput
    });
    Assert(!comparison.ConditionsChanged, "same ruleset and tolerances are comparable");
    Assert(comparison.Rows.Single(x => x.LineId == "amount-resolved").Status == "RESOLVED", "amount FAIL to PASS is resolved");
    Assert(comparison.Rows.Single(x => x.LineId == "quantity-still-bad").Status == "UNCHANGED_FAIL", "unchanged FAIL remains visible");
    Assert(comparison.Rows.Single(x => x.LineId == "=new-unsafe").Status == "NEW_FAIL", "new FAIL is classified");
    Assert(comparison.Rows.Single(x => x.LineId == "removed").Status == "NOT_COMPARABLE", "removed item is not counted as resolved");
    Assert(Csv.Read(comparisonOutput).Any(x => x.Length > 2 && x[2] == "'=new-unsafe"), "comparison CSV neutralizes spreadsheet formulas");

    string changedManifest = Path.Combine(temp, "current-changed.manifest.csv");
    WriteComparisonManifest(changedManifest, currentReport, krwTolerance: "100");
    RunComparisonResult conditionChanged = RunComparer.Compare(new RunComparisonRequest
    {
        PreviousReportPath = previousReport, PreviousManifestPath = previousRunManifest,
        CurrentReportPath = currentReport, CurrentManifestPath = changedManifest,
        OutputPath = Path.Combine(temp, "condition-changed.csv")
    });
    Assert(conditionChanged.ConditionsChanged && conditionChanged.Rows.All(x => x.Status == "CONDITION_CHANGED"), "policy change prevents false resolved/new-fail counts");

    string otherScopeManifest = Path.Combine(temp, "other-scope.manifest.csv");
    WriteComparisonManifest(otherScopeManifest, currentReport, scope: "scope-2");
    RunComparisonResult otherScope = RunComparer.Compare(new RunComparisonRequest
    {
        PreviousReportPath = previousReport, PreviousManifestPath = previousRunManifest,
        CurrentReportPath = currentReport, CurrentManifestPath = otherScopeManifest,
        OutputPath = Path.Combine(temp, "other-scope.csv")
    });
    Assert(otherScope.ConditionsChanged && otherScope.Rows.All(x => x.Status == "CONDITION_CHANGED"), "different scopes never produce resolved results");
    string skippedGateManifest = Path.Combine(temp, "skipped-gate.manifest.csv");
    WriteComparisonManifest(skippedGateManifest, previousReport, sourceGate: "SKIPPED");
    RunComparisonResult skippedGate = RunComparer.Compare(new RunComparisonRequest
    {
        PreviousReportPath = previousReport, PreviousManifestPath = skippedGateManifest,
        CurrentReportPath = currentReport, CurrentManifestPath = currentRunManifest,
        OutputPath = Path.Combine(temp, "skipped-gate.csv")
    });
    Assert(skippedGate.ConditionsChanged && skippedGate.Rows.All(x => x.Status == "CONDITION_CHANGED"), "non-PASS source gates never produce resolved results");

    string tamperedComparisonReport = Path.Combine(temp, "tampered-comparison-input.csv");
    File.Copy(previousReport, tamperedComparisonReport);
    string tamperedComparisonManifest = tamperedComparisonReport + ".manifest.csv";
    WriteComparisonManifest(tamperedComparisonManifest, tamperedComparisonReport);
    File.AppendAllText(tamperedComparisonReport, Environment.NewLine);
    bool tamperedComparisonRejected = false;
    try
    {
        RunComparer.Compare(new RunComparisonRequest
        {
            PreviousReportPath = tamperedComparisonReport, PreviousManifestPath = tamperedComparisonManifest,
            CurrentReportPath = currentReport, CurrentManifestPath = currentRunManifest,
            OutputPath = Path.Combine(temp, "tampered-comparison.csv")
        });
    }
    catch (InvalidDataException) { tamperedComparisonRejected = true; }
    Assert(tamperedComparisonRejected, "tampered report cannot influence comparison status");

    string formulaNamedReport = Path.Combine(temp, "=previous.csv");
    File.Copy(previousReport, formulaNamedReport);
    string formulaNamedManifest = formulaNamedReport + ".manifest.csv";
    WriteComparisonManifest(formulaNamedManifest, formulaNamedReport);
    RunComparisonResult formulaNamed = RunComparer.Compare(new RunComparisonRequest
    {
        PreviousReportPath = formulaNamedReport, PreviousManifestPath = formulaNamedManifest,
        CurrentReportPath = currentReport, CurrentManifestPath = currentRunManifest,
        OutputPath = Path.Combine(temp, "formula-named-comparison.csv")
    });
    Assert(formulaNamed.Rows.Any(x => x.Status == "RESOLVED"), "spreadsheet-safe manifest filename still binds to the real report");

    string duplicateReport = Path.Combine(temp, "duplicate.csv");
    Csv.Write(duplicateReport, new[]
    {
        reportHeader,
        FindingRow("R011", "FAIL", "duplicate", "", "KRW"),
        FindingRow("R011", "FAIL", "duplicate", "", "KRW")
    });
    string duplicateManifest = duplicateReport + ".manifest.csv";
    WriteComparisonManifest(duplicateManifest, duplicateReport);
    RunComparisonResult duplicate = RunComparer.Compare(new RunComparisonRequest
    {
        PreviousReportPath = duplicateReport, PreviousManifestPath = duplicateManifest,
        CurrentReportPath = currentReport, CurrentManifestPath = currentRunManifest,
        OutputPath = Path.Combine(temp, "duplicate-comparison.csv")
    });
    Assert(duplicate.Rows.Single(x => x.LineId == "duplicate").Status == "REVIEW_DUPLICATE", "duplicate stable keys are explicit review, never hidden");
    Console.WriteLine("Lukas QTO Desktop self-test passed.");
}
finally
{
    Directory.Delete(temp, true);
}
