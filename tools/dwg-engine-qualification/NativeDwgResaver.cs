using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text.Json;
using ACadSharp;

namespace DwgEngineQualification;

internal static class NativeDwgResaver
{
    private const int MaximumRequestBytes = 2_097_152;
    private const int MaximumDwgBytes = 209_715_200;
    private const int MaximumReportBytes = 1_048_576;
    private const double GeometryTolerance = 1e-9;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    public static int RunStream(Stream input, Stream output, TextWriter error)
    {
        try
        {
            Span<byte> header = stackalloc byte[16];
            input.ReadExactly(header);
            if (!header[..8].SequenceEqual("1HKRSV01"u8)) throw new InvalidDataException();
            var requestLength = BinaryPrimitives.ReadUInt32BigEndian(header[8..12]);
            var sourceLength = BinaryPrimitives.ReadUInt32BigEndian(header[12..16]);
            if (requestLength is < 1 or > MaximumRequestBytes || sourceLength is < 6 or > MaximumDwgBytes)
                throw new InvalidDataException();
            var requestBytes = new byte[(int)requestLength];
            var sourceBytes = new byte[(int)sourceLength];
            input.ReadExactly(requestBytes);
            input.ReadExactly(sourceBytes);
            if (input.ReadByte() != -1) throw new InvalidDataException();

            var request = SelectedDwgEdits.Load(requestBytes);
            if (!request.IsVersion2) throw new InvalidDataException();
            var sourceSha = Sha(sourceBytes);
            if (request.Evidence.SourceSha256 != sourceSha) throw new InvalidDataException();
            var document = NativeDwgReader.ReadValidatedSource(sourceBytes, out var source);
            var baseline = Inventory(document);
            // Compare complete inventories without granting exemptions to selected handles.
            var noEdit = RoundTrip(document, out _, out _);
            RequireEqual(baseline, noEdit);
            request.Apply(document, sourceSha);
            var expected = Inventory(document);
            var reread = RoundTrip(document, out var outputBytes, out var outputIdentity);
            RequireEqual(expected, reread);
            if (source.HeaderVersion != outputIdentity.HeaderVersion
                || source.Sha256 != sourceSha || Sha(sourceBytes) != sourceSha
                || Sha(requestBytes) != request.Evidence.Sha256)
                throw new InvalidDataException();

            using var report = new BoundedMemoryStream(MaximumReportBytes);
            JsonSerializer.Serialize(report, new
            {
                schemaVersion = "1hk-dwg-resave/1",
                qualification = "experimental-unqualified",
                persistenceAuthority = "not-issued",
                source,
                request = new
                {
                    schemaVersion = "1hk-dwg-edits/2", sha256 = request.Evidence.Sha256,
                    byteSize = requestBytes.Length, handles = request.Evidence.Handles,
                },
                output = outputIdentity,
                engine = new { name = "ACadSharp", version = "3.7.1" },
                verification = new
                {
                    noEditRoundTrip = "passed", selectedEditRoundTrip = "passed",
                    geometryTolerance = GeometryTolerance, inventoriedEntityCount = baseline.Entities.Count,
                    editedEntityCount = request.Evidence.Handles.Count,
                    inventoryCoverage = "supported-fields-only", independentCad = "not-performed",
                },
            }, JsonOptions);
            var reportBytes = report.ToArray();
            if (reportBytes.Length < 1) throw new InvalidDataException();
            "1HKRSO01"u8.CopyTo(header);
            BinaryPrimitives.WriteUInt32BigEndian(header[8..12], (uint)reportBytes.Length);
            BinaryPrimitives.WriteUInt32BigEndian(header[12..16], (uint)outputBytes.Length);
            // Native/request failures above publish nothing. A transport failure here
            // can leave an incomplete frame; consumers must reject it and the nonzero exit.
            output.Write(header);
            output.Write(reportBytes);
            output.Write(outputBytes);
            return 0;
        }
        catch (Exception exception)
        {
            error.WriteLine("native stream resave failed.");
            return exception is ArgumentException or InvalidDataException ? 2 : 1;
        }
    }

    private static CadInventory Inventory(CadDocument document)
    {
        QualificationRunner.RejectUnwritableObjects(document);
        var diagnostics = new List<string>();
        var inventory = QualificationRunner.Inventory(document, diagnostics);
        if (inventory.Entities.Count is < 1 or > 10_000 || inventory.Diagnostics?.Count > 0)
            throw new InvalidDataException();
        return inventory;
    }

    private static CadInventory RoundTrip(CadDocument document, out byte[] bytes, out NativeDwgReader.SourceIdentity identity)
    {
        using var stream = new BoundedMemoryStream(MaximumDwgBytes);
        QualificationRunner.WriteDocument(stream, document, _ => { });
        bytes = stream.ToArray();
        return Inventory(NativeDwgReader.ReadValidatedSource(bytes, out identity));
    }

    private static void RequireEqual(CadInventory expected, CadInventory actual)
    {
        if (SemanticComparer.Compare(expected, actual, ExpectedEdits.None, GeometryTolerance).Failures.Count != 0)
            throw new InvalidDataException();
    }

    private static string Sha(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();

    // Cap both logical writes and backing-array growth (MemoryStream normally doubles).
    internal sealed class BoundedMemoryStream(int maximumBytes) : MemoryStream
    {
        private void Reserve(long end)
        {
            if (end < 0 || end > maximumBytes) throw new InvalidDataException();
            if (end > Capacity) Capacity = (int)Math.Min(maximumBytes, Math.Max(end, Math.Max(256L, (long)Capacity * 2)));
        }
        public override void Write(byte[] buffer, int offset, int count) { Reserve(checked(Position + count)); base.Write(buffer, offset, count); }
        public override void Write(ReadOnlySpan<byte> buffer) { Reserve(checked(Position + buffer.Length)); base.Write(buffer); }
        public override void WriteByte(byte value) { Reserve(checked(Position + 1)); base.WriteByte(value); }
        public override void SetLength(long value) { Reserve(value); base.SetLength(value); }
    }
}
