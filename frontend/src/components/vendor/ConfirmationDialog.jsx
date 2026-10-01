import { useState } from 'react';
import RiskBadge, { describeOperation } from './RiskBadge';
import { formatCurrency } from '../../utils/formatters';

function columnLabel(column) {
  return String(column || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayColumnValue(column, value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && /value|amount|price|cost|budget|salary|revenue|fee/i.test(column)) {
    return formatCurrency(value);
  }
  return String(value);
}

export default function ConfirmationDialog({
  pending,
  onConfirm,
  onCancel,
  isExecuting = false,
}) {
  const [typedConfirmation, setTypedConfirmation] = useState('');
  const [validationError, setValidationError] = useState('');

  if (!pending) return null;

  const operation = describeOperation(pending.intent, pending.riskLevel);
  const isCritical = Boolean(
    pending.confirmPhrase ||
    operation.label === 'Critical operation'
  );
  const isSchema = operation.label === 'Schema modification';
  const actionName = pending.intent
    ? `${pending.intent.charAt(0).toUpperCase()}${pending.intent.slice(1).toLowerCase()}`
    : 'Operation';

  const targetPhrase = pending.confirmPhrase || (isCritical ? `${pending.intent || 'CONFIRM'} ${pending.targetTable || ''}`.trim() : '');
  const isValid = !targetPhrase || typedConfirmation.trim().toLowerCase() === targetPhrase.trim().toLowerCase();

  const handleConfirmClick = () => {
    if (targetPhrase && !isValid) {
      setValidationError(`Please type "${targetPhrase}" exactly to confirm.`);
      return;
    }
    setValidationError('');
    onConfirm(typedConfirmation);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Intella confirmation">
      <div className={`modal-card confirmation-card ${isCritical ? 'critical-border' : ''}`}>
        <div className="confirmation-header">
          <div className="confirmation-title-wrap">
            <span className="confirmation-icon" aria-hidden="true">{isCritical ? '!' : '•'}</span>
            <div>
              <h3 className="confirmation-title">
                {isCritical
                  ? 'Critical Database Operation'
                  : isSchema
                    ? 'Schema modification'
                    : 'Data modification'}
              </h3>
              <p className="confirmation-subtitle">
                Intella generated this for <strong>{pending.targetTable || 'the connected database'}</strong>
              </p>
            </div>
          </div>
          <RiskBadge intent={pending.intent} riskLevel={pending.riskLevel} />
        </div>

        <div className="confirmation-body">
          {pending.explanation && (
            <p className="confirmation-explanation">{pending.explanation}</p>
          )}

          {pending.estimatedRows != null && (
            <div className="confirmation-row-notice">
              <span className="info-dot">●</span>
              <span>
                <strong>{pending.estimatedRows}</strong> {pending.estimatedRows === 1 ? 'row' : 'rows'} will be modified or affected.
              </span>
            </div>
          )}

          {isCritical && (
            <div className="confirmation-warning-banner">
              This operation may permanently remove data.
            </div>
          )}

          {pending.columnValues && (
            <div className="confirmation-row-notice">
              <div>
                <strong>Intella interpreted</strong>
                <p className="confirmation-subtitle">Table: {pending.targetTable || 'connected table'}</p>
                <dl className="connection-success-meta">
                  {Object.entries(pending.columnValues).map(([column, value]) => (
                    <div key={column}>
                      <dt>{columnLabel(column)}</dt>
                      <dd>{displayColumnValue(column, value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          )}

          {pending.sql && (
            <div className="confirmation-sql-box">
              <div className="sql-box-header">Intella generated</div>
              <pre className="confirmation-sql">
                <code>{pending.sql}</code>
              </pre>
            </div>
          )}

          {targetPhrase && (
            <div className="confirmation-input-section">
              <label htmlFor="confirm-phrase-input" className="confirm-input-label">
                Type <code>{targetPhrase}</code> to confirm:
              </label>
              <input
                id="confirm-phrase-input"
                type="text"
                className="confirm-phrase-input"
                placeholder={targetPhrase}
                value={typedConfirmation}
                onChange={(e) => {
                  setTypedConfirmation(e.target.value);
                  if (validationError) setValidationError('');
                }}
                autoFocus
              />
              {validationError && (
                <p className="confirm-error-text">{validationError}</p>
              )}
            </div>
          )}
        </div>

        <div className="confirmation-footer">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
            disabled={isExecuting}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`btn ${isCritical ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleConfirmClick}
            disabled={isExecuting || (Boolean(targetPhrase) && !isValid)}
          >
            {isExecuting
              ? 'Executing...'
              : isCritical && !isValid
                ? 'Type confirmation'
                : `Confirm ${actionName}`}
          </button>
        </div>
      </div>
    </div>
  );
}
