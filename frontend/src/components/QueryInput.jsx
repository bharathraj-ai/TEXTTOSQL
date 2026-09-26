import { useState, useEffect } from 'react';

export default function QueryInput({ onSubmit, isLoading, externalQuestion, onExternalQuestionConsumed }) {
  const [question, setQuestion] = useState('');

  // Handle external question from history/suggestion click
  useEffect(() => {
    if (externalQuestion && externalQuestion !== question) {
      setQuestion(externalQuestion);
      if (onExternalQuestionConsumed) onExternalQuestionConsumed();
    }
  }, [externalQuestion, question, onExternalQuestionConsumed]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!question.trim() || isLoading) return;
    onSubmit(question.trim());
  };

  return (
    <section className="query-input-section">
      <div className="section-header">
        <div className="section-icon">💬</div>
        <h2>Ask your database</h2>
      </div>

      <form onSubmit={handleSubmit} className="query-form">
        <div className="input-wrapper">
          <textarea
            id="query-textarea"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder='Ask your database...  "Show students above 80"'
            rows={2}
            disabled={isLoading}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
          />
          <button
            type="submit"
            className="run-btn"
            disabled={!question.trim() || isLoading}
            id="run-query-btn"
          >
            {isLoading ? (
              <>
                <span className="spinner"></span>
                Processing...
              </>
            ) : (
              <>
                <span className="btn-icon">▶</span>
                Run Query
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
