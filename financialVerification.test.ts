import { describe, expect, it } from 'vitest';
import { verifyFinancialAnswer } from './financialVerification';
import { calculatePER, calculatePBR, calculateROA } from './marketMetrics';
describe('independent verification and market metrics',()=>{
 it('rejects mismatched operating margin',()=>{const x=verifyFinancialAnswer({value:12,metricId:'operatingMargin',period:'2026 H1',basis:'CFS',rceptNo:'20260814003722',calcInputs:[{label:'영업이익',value:100},{label:'매출액',value:2000}]});expect(x.status).toBe('failed');});
 it('never claims demo source independently verified',()=>{const x=verifyFinancialAnswer({value:1,demo:true,period:'2026 H1',basis:'CFS'});expect(x.status).toBe('partial');});
 it('requires compatible currencies and positive EPS',()=>{const q={price:5000,priceDate:'2026-10-08',source:'licensed feed',adjusted:false,currency:'KRW'};expect('error' in calculatePER(q,-10,'KRW')).toBe(true);expect('error' in calculatePBR(q,100,'USD')).toBe(true);});
 it('uses mean of two balance sheet dates for ROA',()=>{const r=calculateROA(100,1200,800);expect('value' in r && r.value).toBe(10);});
});
