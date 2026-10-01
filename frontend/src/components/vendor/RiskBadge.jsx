export function describeOperation(intent, riskLevel) {
  const normalizedIntent = String(intent || '').toUpperCase();
  const normalizedRisk = String(riskLevel || '').toUpperCase();

  if (normalizedRisk === 'CRITICAL' || normalizedIntent === 'DROP' || normalizedIntent === 'TRUNCATE') {
    return { intent: normalizedIntent, label: 'Critical operation', className: 'risk-critical' };
  }
  if (normalizedIntent === 'CREATE' || normalizedIntent === 'ALTER') {
    return { intent: normalizedIntent, label: 'Schema modification', className: 'risk-high' };
  }
  if (normalizedIntent === 'INSERT' || normalizedIntent === 'UPDATE' || normalizedIntent === 'DELETE') {
    return { intent: normalizedIntent, label: 'Data modification', className: 'risk-medium' };
  }
  if (normalizedIntent === 'SELECT' || normalizedIntent === 'READ') {
    return { intent: normalizedIntent, label: 'Read operation', className: 'risk-low' };
  }
  if (normalizedRisk === 'HIGH') {
    return { intent: normalizedIntent, label: 'Data modification', className: 'risk-high' };
  }
  return { intent: normalizedIntent, label: normalizedIntent === 'BLOCKED' ? 'Blocked' : 'Read operation', className: 'risk-low' };
}

export default function RiskBadge({ intent, riskLevel }) {
  const operation = describeOperation(intent, riskLevel);

  return (
    <span className={`risk-badge ${operation.className}`} title={`${operation.intent || 'Operation'} · ${operation.label}`}>
      <span className="risk-text">{operation.intent ? `${operation.intent} · ${operation.label}` : operation.label}</span>
    </span>
  );
}
