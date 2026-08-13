using System;
using System.Collections.Generic;

namespace THEKIE.Qto.Core
{
    public sealed class QtoRecord
    {
        public string Id { get; set; }
        public string Category { get; set; }
        public string Family { get; set; }
        public string Type { get; set; }
        public string Level { get; set; }
        public decimal Count { get; set; }
        public decimal VolumeM3 { get; set; }
        public decimal AreaM2 { get; set; }
        public decimal LengthM { get; set; }
        public int SourceRow { get; set; }
        public List<string> ElementIds { get; } = new List<string>();

        public decimal Measure(string measure)
        {
            switch (measure)
            {
                case "EA": return Count;
                case "m": return LengthM;
                case "m2": return AreaM2;
                case "m3": return VolumeM3;
                default: throw new ArgumentException("지원하지 않는 수량 단위입니다: " + measure, "measure");
            }
        }
    }

    public sealed class EstimateLine
    {
        public string Id { get; set; }
        public string Description { get; set; }
        public string Unit { get; set; }
        public decimal? Quantity { get; set; }
        public decimal? UnitPriceKrw { get; set; }
        public decimal? AmountKrw { get; set; }
        public decimal? MaterialUnitPriceKrw { get; set; }
        public decimal? LaborUnitPriceKrw { get; set; }
        public decimal? ExpenseUnitPriceKrw { get; set; }
        public decimal? MaterialAmountKrw { get; set; }
        public decimal? LaborAmountKrw { get; set; }
        public decimal? ExpenseAmountKrw { get; set; }
        public bool UseComponentTruncation { get; set; }
        public bool IsAdjustment { get; set; }
        internal bool IsEmsSource { get; set; }
        public int SourceRow { get; set; }
    }

    public sealed class Mapping
    {
        public string EstimateLineId { get; set; }
        public string QtoId { get; set; }
        public string Unit { get; set; }
        public decimal Multiplier { get; set; }
        public int SourceRow { get; set; }
    }

    public sealed class Finding
    {
        public string Rule { get; set; }
        public string Status { get; set; }
        public string Severity { get; set; }
        public string LineId { get; set; }
        public string QtoId { get; set; }
        public string Unit { get; set; }
        public decimal? Expected { get; set; }
        public decimal? Actual { get; set; }
        public decimal? Delta { get; set; }
        public string Evidence { get; set; }
        public string Message { get; set; }
    }

    public sealed class EstimateSummary
    {
        public decimal MaterialSubtotal { get; set; }
        public decimal IndirectLabor { get; set; }
        public decimal LaborSubtotal { get; set; }
        public decimal ExpenseAdditions { get; set; }
        public decimal ExpenseSubtotal { get; set; }
        public decimal DirectCost { get; set; }
        public decimal GeneralAdmin { get; set; }
        public decimal Profit { get; set; }
        public decimal SupplyAdditions { get; set; }
        public decimal SupplyAmount { get; set; }
        public decimal Vat { get; set; }
        public decimal ContractAmount { get; set; }
        public decimal FinalAdditions { get; set; }
        public bool HasFinalAdditions { get; set; }
        public decimal TotalAmount { get; set; }
        public Dictionary<string, int> SourceRows { get; } = new Dictionary<string, int>();
    }

    public sealed class AuditPolicy
    {
        public decimal QuantityTolerance { get; set; }
        public decimal KrwTolerance { get; set; }
    }
}
