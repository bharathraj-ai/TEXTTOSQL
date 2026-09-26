export default function ExplanationDisplay({ explanation }) {
  if (!explanation) return null;

  return (
    <section className="explanation-section">
      <div className="section-header">
        <div className="section-icon">💡</div>
        <h2>Explanation</h2>
      </div>
      <div className="explanation-content">
        <p>{explanation}</p>
      </div>
    </section>
  );
}
