/**
 * Full text of the EPGL Declaration & Undertaking (Round-1-internal feedback
 * FB-1450: the applicant must be able to READ what they are agreeing to before
 * ticking the in-chat checkbox — the checkbox label links here). Static,
 * bilingual, printable. Content mirrors the Salesforce declaration wording;
 * confirm final legal copy with EPGL before production.
 */
export const metadata = { title: "EPGL Declaration & Undertaking" };

const S: Record<string, React.CSSProperties> = {
  page: { fontFamily: "-apple-system, 'Segoe UI', system-ui, sans-serif", background: "#f2f6fb", minHeight: "100vh", padding: "32px 16px", color: "#13132e" },
  card: { maxWidth: 720, margin: "0 auto", background: "#fff", border: "1px solid #e1e8f0", borderRadius: 14, padding: "32px 36px" },
  h1: { fontSize: 22, margin: "0 0 4px", color: "#0052a3" },
  sub: { fontSize: 13, color: "#5B6478", margin: "0 0 24px" },
  h2: { fontSize: 16, margin: "24px 0 8px" },
  p: { fontSize: 14, lineHeight: 1.65, margin: "0 0 10px" },
  li: { fontSize: 14, lineHeight: 1.65, margin: "0 0 6px" },
  ar: { direction: "rtl" as const, textAlign: "right" as const },
  hr: { border: "none", borderTop: "1px solid #e1e8f0", margin: "28px 0" },
};

export default function EpglDeclarationPage() {
  return (
    <div style={S.page}>
      <div style={S.card}>
        <h1 style={S.h1}>Declaration &amp; Undertaking</h1>
        <p style={S.sub}>Emirates Post Group — Postal Activity Licensing (EPGL)</p>

        <p style={S.p}>By accepting this declaration in the application, the applicant (the authorised owner or representative of the company) declares and undertakes that:</p>
        <ol>
          <li style={S.li}>All information and documents provided in this application are true, accurate, complete, and up to date, and the applicant bears full responsibility for any incorrect or misleading information.</li>
          <li style={S.li}>The company will conduct its postal / courier activities in accordance with the applicable UAE laws and regulations and the licensing terms and conditions issued by Emirates Post Group Licensing.</li>
          <li style={S.li}>The company will maintain a valid trade license for the duration of the postal activity license and will notify EPGL of any change to its legal status, ownership, or contact details.</li>
          <li style={S.li}>The company consents to the verification of the submitted information and documents with the competent authorities, and to the mandatory integration with the IDEP platform for the reporting of leviable income where applicable.</li>
          <li style={S.li}>Licensing fees are payable as requested and are non-refundable once the application has been processed.</li>
          <li style={S.li}>Failure to comply with these undertakings may result in the suspension or cancellation of the postal activity license.</li>
        </ol>

        <hr style={S.hr} />

        <div style={S.ar}>
          <h1 style={{ ...S.h1 }}>الإقرار والتعهد</h1>
          <p style={S.sub}>مجموعة بريد الإمارات — ترخيص الأنشطة البريدية</p>
          <p style={S.p}>بقبول هذا الإقرار ضمن الطلب، يقرّ مقدم الطلب (المالك أو الممثل المفوض عن الشركة) ويتعهد بما يلي:</p>
          <ol>
            <li style={S.li}>أن جميع المعلومات والمستندات المقدمة في هذا الطلب صحيحة ودقيقة وكاملة ومحدّثة، ويتحمل مقدم الطلب المسؤولية الكاملة عن أي معلومات غير صحيحة أو مضللة.</li>
            <li style={S.li}>أن تمارس الشركة أنشطتها البريدية وفقاً للقوانين والأنظمة المعمول بها في دولة الإمارات وشروط وأحكام الترخيص الصادرة عن مجموعة بريد الإمارات.</li>
            <li style={S.li}>أن تحافظ الشركة على رخصة تجارية سارية طوال مدة رخصة النشاط البريدي، وأن تُخطر الجهة المرخِّصة بأي تغيير في وضعها القانوني أو ملكيتها أو بيانات الاتصال الخاصة بها.</li>
            <li style={S.li}>أن توافق الشركة على التحقق من المعلومات والمستندات المقدمة لدى الجهات المختصة، وعلى التكامل الإلزامي مع منصة IDEP للإفصاح عن الدخل الخاضع للرسوم حيثما ينطبق.</li>
            <li style={S.li}>أن رسوم الترخيص تُدفع عند طلبها وغير قابلة للاسترداد بعد معالجة الطلب.</li>
            <li style={S.li}>أن عدم الالتزام بهذه التعهدات قد يؤدي إلى تعليق رخصة النشاط البريدي أو إلغائها.</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
