import React from 'react';
import type { Verdict } from '../../../../shared/api.interface';
import { Badge } from '../../components/ui/badge';
import { VERDICT_LABEL } from './research-format';

const VerdictBadge: React.FC<{ verdict: Verdict }> = ({ verdict }) =>
  <Badge variant="outline" className={verdict === 'pass' ? 'border-primary/20 bg-primary/5 text-primary'
    : verdict === 'unknown' ? 'border-warning/25 bg-warning/5 text-warning' : 'text-muted-foreground'}>
    {VERDICT_LABEL[verdict]}
  </Badge>;

export default VerdictBadge;
