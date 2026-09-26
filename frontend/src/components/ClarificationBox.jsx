import { useState } from 'react';

export default function ClarificationBox({ message, options, originalQuestion, onSelect, isLoading }) {
  const [selected, setSelected] = useState(null);

  const handleOptionClick = (option) => {
    setSelected(option);
    onSelect(originalQuestion, option);
  };

  return (
    <section className="clarification-section">
      <div className="clarification-card">
        <div className="clarification-header">
          <span className="clarification-icon">🤔</span>
          <h3>I need a little clarification</h3>
        </div>
        <p className="clarification-message">{message}</p>
        <div className="clarification-options">
          {options.map((option, i) => (
            <button
              key={i}
              className={`clarification-option ${selected === option ? 'selected' : ''}`}
              onClick={() => handleOptionClick(option)}
              disabled={isLoading}
            >
              {isLoading && selected === option ? (
                <>
                  <span className="spinner"></span>
                  Processing...
                </>
              ) : (
                option
              )}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
