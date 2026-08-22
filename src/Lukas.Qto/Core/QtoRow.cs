using System;
using System.Collections.Generic;

using System.Security.Cryptography;
using System.Text;

namespace Lukas.Qto.Core
{
    /// <summary>
    /// 집계 1행. 내역서의 한 항목에 대응하는 것을 목표로 한다.
    /// </summary>
    public class QtoRow
    {
        public string Category { get; set; }
        public string FamilyName { get; set; }
        public string TypeName { get; set; }
        public string Level { get; set; }

        public int Count { get; set; }
        public double VolumeM3 { get; set; }
        public double AreaM2 { get; set; }
        public double LengthM { get; set; }

        /// <summary>추적성 확보용. 검산 결과에서 원본 요소로 되짚어가기 위해 반드시 보존한다.</summary>
        public List<long> ElementIds { get; } = new List<long>();

        public string GroupKey
        {
            get { return Category + "\u001F" + FamilyName + "\u001F" + TypeName + "\u001F" + Level; }
        }

        /// <summary>CSV와 내역 매핑에서 쓰는 안정적인 집계 식별자. 제어문자를 CSV에 노출하지 않는다.</summary>
        public string AuditKey
        {
            get
            {
                using (var sha = SHA256.Create())
                {
                    byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(GroupKey));
                    return BitConverter.ToString(bytes).Replace("-", "");
                }
            }
        }
    }
}
