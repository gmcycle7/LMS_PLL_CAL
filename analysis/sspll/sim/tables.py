#!/usr/bin/env python3
"""Print the markdown tables used in README.md from results.json (no recomputation)."""
import json
import os
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
R = json.load(open(os.path.join(HERE, 'results.json')))
nz = lambda x: float('nan') if x is None else x


def t_loops():
    print('| loop | 型態 / 參數 | PM (deg) | f_c (MHz) | peaking (dB, td) | abs T(320 MHz) (td) | Re{H_PD}<0 band (MHz, td) | min Re{H_PD} (td) |')
    print('|---|---|---|---|---|---|---|---|')
    for k, L in R['loops'].items():
        d = L['design']
        m = d['meta']
        v = L['td_verify']
        if m['kind'] == 'L1':
            par = 'K=%.4f, lat=%d%s' % (m['K'], m['lat'], '' if not m.get('pole_f') else ', pole %.0f MHz' % (m['pole_f'] / 1e6))
        elif m['kind'] == 'L2':
            par = 'Kp=%.4f, Ki=%.5f, lat=%d' % (m['Kp'], m['Ki'], m['lat'])
        else:
            par = '%s, PM_ct=%d, f_c,ct=%.1f MHz, f_z=%.1f, f_p=%.1f MHz' % (m['mapping'], m['pm_ct'], m['fc_ct_Hz'] / 1e6, m['fz_Hz'] / 1e6, m['fp_Hz'] / 1e6)
        bands = v['ReH_negative_bands_Hz_td']
        bs = ', '.join('DC-%.0f' % (b[1] / 1e6) if b[0] <= 2.1e6 else '%.0f-%.0f' % (b[0] / 1e6, b[1] / 1e6) for b in bands) or 'none'
        print('| %s | %s | %.1f | %.1f | %.2f | %.4f | %s | %+.3f |' % (k, par, d['pm_deg'], d['fc_Hz'] / 1e6, v['peaking_dB_td'], v['T_mag_at_320M_td'], bs, v['ReH_min_td']))


def t_grid(keys=('L1', 'L2_pm60', 'L3_imp_pm60', 'L2_pm45', 'L2_pm75', 'L2_pm60_lat2', 'L1_pole400M', 'L3_zoh_pm60')):
    al = [d['alpha'] for d in R['grid']['L1']['summary']]
    print('| loop | ' + ' | '.join('%g' % a for a in al) + ' |')
    print('|---|' + '---|' * len(al))
    for k in keys:
        row = []
        for d in R['grid'][k]['summary']:
            e = d['variants']['raw']['erf']
            ol = d['open_loop_H1']['erf']
            kp = e['phos_min_re'] / ol['phos_min_re']
            kg = e['mS_gg'] / ol['mS_gg']
            mark = '**' if kp < -0.01 else ''
            row.append('%s%+.3f%s / %+.3f' % (mark, kp, mark, kg))
        print('| %s | ' % k + ' | '.join(row) + ' |')


def t_fine():
    print('| loop | PHOS small-signal inverted α (fine sweep, step 0.001) | worst κ_PHOS @ α | GOS small-signal inverted |')
    print('|---|---|---|---|')
    for k in R['loops']:
        s = R['fine_summary']['fine|' + k]['raw']
        f = R['fine'][k]
        a = np.array(f['alpha'])
        p = np.array([nz(x) for x in f['variants']['raw']['erf']['phos_min_re']])
        pr = np.abs(np.array([nz(x) for x in f['open_loop_H1']['phos_min_re']]))
        kp = p / pr
        i = int(np.nanargmin(kp))
        iv = ', '.join('[%g, %g]' % (x[0], x[1]) for x in s['phos_inverted_intervals']) or 'none'
        print('| %s | %s | %+.3f @ %g | %d / 500 |' % (k, iv, kp[i], a[i], s['gos_inverted']))


def t_large():
    print('| loop | A = 1 ps (5σ_v) inverted α | A = 5 ps (25σ_v) inverted α | worst (5 ps) |')
    print('|---|---|---|---|')
    for k, r in R['large_signal_fine'].items():
        s = r['summary']['raw']
        iv1 = ', '.join('[%g, %g]' % (x[0], x[1]) for x in s['A=1ps']['inverted_intervals']) or 'none'
        iv5 = ', '.join('[%g, %g]' % (x[0], x[1]) for x in s['A=5ps']['inverted_intervals']) or 'none'
        print('| %s | %s | %s | %+.3f @ %g |' % (k, iv1, iv5, nz(s['A=5ps']['worst']), nz(s['A=5ps']['worst_alpha'])))


def t_remedy_counts():
    print('| loop | raw | x[n]-x[n-1] | x[n]-2x[n-1]+x[n-2] | filtered-x exact | filtered-x BW-20% | filtered-x BW+20% | D=1 | MASH-1-1-1 (α step 0.005) | rot8 (α step 0.005) | large-signal raw (1 ps / 5 ps) | large-signal 1diff | large-signal fx |')
    print('|---|' + '---|' * 12)
    for k in R['loops']:
        s = R['fine_summary']['fine|' + k]
        c = lambda v: '%d' % s[v]['phos_inverted'] if v in s else '-'
        cj = lambda v: s[v]['joint_inverted'] if v in s else -1
        m = R['fine_summary']['dither_fine|%s|mash' % k]['raw']['joint_inverted']
        r8 = R['fine_summary']['dither_fine|%s|rot8' % k]['raw']['joint_inverted']
        ls = R['large_signal_fine'][k]['summary']
        lsr = '%d / %d' % (ls['raw']['A=1ps']['n_inverted'], ls['raw']['A=5ps']['n_inverted'])
        ls1 = '%d / %d' % (ls['1diff']['A=1ps']['n_inverted'], ls['1diff']['A=5ps']['n_inverted'])
        lsf = '%d / %d' % (ls['fx:exact']['A=1ps']['n_inverted'], ls['fx:exact']['A=5ps']['n_inverted'])
        print('| %s | %d | %d | %d | %d | %d | %d | %d | %d / 100 | %d / 100 | %s | %s | %s |' % (
            k, cj('raw'), cj('1diff'), cj('2diff'), cj('fx:exact'), cj('fx:bw0.8'), cj('fx:bw1.2'), cj('D:1'), m, r8, lsr, ls1, lsf))


def t_lms():
    print('| run | α | raw | filtered-x exact | fx BW-20% | fx BW+20% | 2nd diff | 1st diff | MASH-1-1-1 | rot8 |')
    print('|---|---|---|---|---|---|---|---|---|---|')
    for k in ['L1', 'L2_pm60', 'L3_imp_pm60', 'L2_pm45', 'L3_zoh_pm60', 'L1_pole400M']:
        L = R['lms']['%s|acc1' % k]
        Lm = R['lms']['%s|mash' % k]
        Lr = R['lms']['%s|rot8' % k]
        for a in L['alphas']:
            row = []
            for v in ['raw', 'fx:exact', 'fx:bw0.8', 'fx:bw1.2', '2diff', '1diff']:
                ln = L['lanes'].get('%.6g|%s' % (a, v))
                row.append('%.0f' % ln['phos_err_final_med_fs'] if ln else '-')
            row.append('%.0f' % Lm['lanes']['%.6g|raw' % a]['phos_err_final_med_fs'])
            row.append('%.0f' % Lr['lanes']['%.6g|raw' % a]['phos_err_final_med_fs'])
            print('| %s | %g | %s |' % (k, a, ' | '.join(row)))


def t_from_cal():
    print('| loop | α | raw | mean-removed GOS (ac) | 1st diff | filtered-x |')
    print('|---|---|---|---|---|---|')
    for k, L in R['lms_extra'].items():
        if 'from_cal' not in k:
            continue
        for a in L['alphas']:
            row = ['%.0f' % L['lanes']['%.6g|%s' % (a, v)]['phos_err_final_med_fs'] for v in L['variants']]
            print('| %s | %g | %s |' % (k.split('|')[0], a, ' | '.join(row)))


for name, fn in (('loops', t_loops), ('grid', t_grid), ('fine', t_fine), ('large', t_large),
                 ('remedy_counts', t_remedy_counts), ('lms', t_lms), ('from_cal', t_from_cal)):
    print('\n### %s\n' % name)
    fn()
