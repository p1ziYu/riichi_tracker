// Authored cross-cutting vectors; the runner records each public engine invocation.
export async function generate(engine) {
  const version = engine.ENGINE_VERSION;
  const four = engine.HOUSE_4P_V1;
  const three = engine.HOUSE_3P_V1;

  function invoke(category, count, operation) {
    process.env.GOLDEN_TAGS = `${category},${count}p`;
    return operation();
  }

  function expectedError(category, count, operation, message) {
    let error;
    try {
      invoke(category, count, operation);
    } catch (caught) {
      error = caught;
    }
    if (!(error instanceof Error) || !message.test(error.message)) {
      throw new Error(`Expected ${category} to fail with ${message}; received ${String(error)}`);
    }
  }

  function rules(count, overrides = {}) {
    return { rulesHash: `supplementary-${count}p`, config: { ...(count === 3 ? three : four), ...overrides } };
  }

  function hand(count, overrides = {}) {
    const { seatPoints, riichiSeats = [], tenpaiSeats = [], ...fields } = overrides;
    const base = count === 3 ? three : four;
    return {
      handId: `supplementary-${count}p`, roundWind: 'E', roundNumber: 1,
      dealerSeatNo: 0, honba: 0, riichiPool: 0,
      seats: Array.from({ length: count }, (_, seatNo) => ({
        seatNo, points: seatPoints?.[seatNo] ?? base.startingPoints,
        isRiichi: riichiSeats.includes(seatNo), isTenpai: tenpaiSeats.includes(seatNo),
      })),
      markRevision: 0n, resultRevision: 0n, ...fields,
    };
  }

  function settle(category, count, config, state, result) {
    return invoke(category, count, () => engine.calculateSettlement(rules(count, config), state, result, version));
  }

  function terminal(category, count, config, points, pool = 0, options = {}) {
    const startingPoints = config.startingPoints ?? (count === 3 ? three : four).startingPoints;
    if (points.reduce((sum, point) => sum + point, pool) !== count * startingPoints) {
      throw new Error(`Invalid authored terminal ledger: ${category}`);
    }
    return invoke(category, count, () => engine.calculateTerminalSettlement(
      { points, riichiPool: pool }, rules(count, config), options,
    ));
  }

  const win = (seatNo, dealInSeatNo, han = 2, fu = 30) => ({ seatNo, dealInSeatNo, han, fu });
  const draw = (tenpai) => ({ kind: 'ryuukyoku', winners: [], tenpai });

  // Every policy, both player counts, both two-winner submission orders; 4p also
  // exercises three simultaneous claims and the house abortive-draw rule.
  for (const count of [4, 3]) {
    const state = hand(count, { dealerSeatNo: 1, honba: 2, riichiPool: 2000 });
    for (const multiRon of ['head_bump', 'double_ron', 'allow_all']) {
      for (const doubleRonHonbaPolicy of ['each_winner', 'nearest_only']) {
        for (const seats of [[count - 1, 1], [1, count - 1]]) {
          settle('multi_ron', count, { multiRon, doubleRonHonbaPolicy }, state, {
            kind: 'ron', winners: seats.map((seat) => win(seat, 0)),
          });
        }
      }
      if (count === 4) {
        for (const seats of [[3, 1, 2], [2, 3, 1]]) {
          settle('triple_ron', count, { multiRon }, state, {
            kind: 'ron', winners: seats.map((seat) => win(seat, 0)),
          });
        }
      }
    }
  }

  // All bitmap partitions include all-noten and all-tenpai. An explicitly
  // disabled penalty changes payments but not dealer continuation.
  for (const count of [4, 3]) {
    for (let bitmap = 0; bitmap < (1 << count); bitmap++) {
      const tenpai = Array.from({ length: count }, (_, seat) => Boolean(bitmap & (1 << seat)));
      for (const notenPenaltyTotal of [count === 3 ? 2000 : 3000, 0]) {
        settle('tenpai_bitmap', count, { notenPenaltyTotal }, hand(count, { honba: 1, riichiPool: 1000 }), draw(tenpai));
      }
    }
    expectedError('invalid_noten_1500', count, () => engine.normalizeRulesConfig({ playerCount: count, notenPenaltyTotal: 1500 }), /notenPenaltyTotal/);
  }

  const fuValues = [20, 22, 25, 30, 32, 40, 45, 50, 60, 70, 80, 90, 100, 110, 120, 130];
  for (const count of [4, 3]) {
    for (const fu of fuValues) {
      for (const kind of ['ron', 'tsumo']) {
        for (const dealer of [true, false]) {
          for (const kiriageMangan of [false, true]) {
            const winner = dealer ? 0 : 1;
            settle('fu_matrix', count, { kiriageMangan }, hand(count), {
              kind, winners: [kind === 'ron' ? win(winner, dealer ? 1 : 0, 1, fu) : { seatNo: winner, han: 1, fu }],
            });
          }
        }
      }
    }
    for (const [han, fu] of [[4, 30], [3, 60]]) {
      for (const kiriageMangan of [false, true]) {
        settle('kiriage_boundary', count, { kiriageMangan }, hand(count), {
          kind: 'ron', winners: [win(1, 0, han, fu)],
        });
      }
    }
  }
  for (const tsumoLoss of [true, false]) {
    for (const dealer of [true, false]) {
      for (const fu of [22, 32]) {
        settle('sanma_tsumo_remainder', 3, { tsumoLoss }, hand(3), {
          kind: 'tsumo', winners: [{ seatNo: dealer ? 0 : 1, han: 1, fu }],
        });
      }
    }
  }

  for (const count of [4, 3]) {
    for (const kind of ['ron', 'tsumo']) {
      for (const kazoeYakuman of [false, true]) {
        for (const han of [12, 13, 14]) {
          settle('kazoe', count, { kazoeYakuman }, hand(count), {
            kind, winners: [kind === 'ron' ? win(1, 0, han, 30) : { seatNo: 1, han, fu: 30 }],
          });
        }
      }
      for (const compositeYakuman of [false, true]) {
        for (const doubleYakuman of [false, true]) {
          for (const yakumanCount of [1, 2]) {
            const winner = { seatNo: 1, han: 1, fu: 30, yakumanCount };
            settle('yakuman', count, { compositeYakuman, doubleYakuman }, hand(count), {
              kind, winners: [kind === 'ron' ? { ...winner, dealInSeatNo: 0 } : winner],
            });
          }
          const special = { seatNo: 1, han: 1, fu: 30, yakumanCount: 1, doubleYakumanCount: 1 };
          const result = { kind, winners: [kind === 'ron' ? { ...special, dealInSeatNo: 0 } : special] };
          if (doubleYakuman) {
            settle('yakuman_special_double', count, { compositeYakuman, doubleYakuman }, hand(count), result);
          } else {
            expectedError('yakuman_special_double_disabled', count, () => engine.calculateSettlement(
              rules(count, { compositeYakuman, doubleYakuman }), hand(count), result, version,
            ), /double yakuman is disabled/);
          }
        }
      }
    }
    for (const offender of [0, 1]) {
      for (const declaredRiichi of [false, true]) {
        const state = hand(count, { dealerSeatNo: 0, honba: 2, riichiPool: 1000,
          riichiSeats: declaredRiichi ? [offender] : [] });
        settle('chombo_replay', count, {}, state, {
          kind: 'chombo', winners: [], chomboRole: { [offender]: 'offender' },
        });
        settle('chombo_manual', count, {}, state, {
          kind: 'chombo', winners: [], chomboRole: { [offender]: 'offender' },
          manualPayments: { [offender]: -1000, [(offender + 1) % count]: 1000 },
        });
      }
    }
  }

  const eligibility = (seats) => seats.map((seatNo) => ({
    seatNo, discards: [{ tile: '1m', called: false }, { tile: '7z', called: false }],
  }));
  for (const count of [4, 3]) {
    for (const collects of [false, true]) {
      for (const repeatRequiresTenpai of [false, true]) {
        for (const dealerTenpai of [false, true]) {
          const seats = [0];
          settle('nagashi_single', count, {
            nagashiManganEnabled: true, nagashiCollectsRiichiPool: collects,
            nagashiDealerRepeatRequiresTenpai: repeatRequiresTenpai,
          }, hand(count, { riichiPool: 2000 }), {
            kind: 'nagashi_mangan', winners: seats.map((seatNo) => ({ seatNo, han: 5, fu: 30 })),
            nagashiEligibility: eligibility(seats),
            tenpai: Array.from({ length: count }, (_, seat) => seat === 0 && dealerTenpai),
          });
        }
        for (const seats of [[2, 1], [1, 2]]) {
          settle('nagashi_two_winners', count, {
            nagashiManganEnabled: true, nagashiCollectsRiichiPool: collects,
            nagashiDealerRepeatRequiresTenpai: repeatRequiresTenpai,
          }, hand(count, { riichiPool: 1000 }), {
            kind: 'nagashi_mangan', winners: seats.map((seatNo) => ({ seatNo, han: 5, fu: 30 })),
            nagashiEligibility: eligibility(seats), tenpai: Array(count).fill(false),
          });
        }
      }
    }
  }

  // Terminal ledgers are guarded by terminal() before reaching the engine.
  for (const count of [4, 3]) {
    const negatives = count === 4 ? [-100, 40000, 30000, 30100] : [-100, 50000, 55100];
    const ties = count === 4 ? [30000, 30000, 20000, 20000] : [40000, 40000, 25000];
    const pooled = count === 4 ? [34000, 33000, 16000, 15000] : [45000, 40000, 18000];
    for (const tiedUmaPolicy of ['seat_order', 'split']) {
      for (const terminalRiichiPoolPolicy of ['first', 'unallocated']) {
        terminal('terminal_negative', count, { tiedUmaPolicy, terminalRiichiPoolPolicy }, negatives);
        terminal('terminal_tie', count, { tiedUmaPolicy, terminalRiichiPoolPolicy }, ties, 0,
          { startingDealerSeatNo: 1 });
        terminal('terminal_pool', count, { tiedUmaPolicy, terminalRiichiPoolPolicy }, pooled, 2000);
      }
    }
  }
  // Indivisible negative tied uma uses floor division, not truncation toward zero.
  for (const count of [4, 3]) {
    for (const tiedUmaPolicy of ['seat_order', 'split']) {
      for (const terminalRiichiPoolPolicy of ['first', 'unallocated']) {
        terminal('terminal_negative_uma_remainder', count, {
          uma: count === 4 ? [0.1, -0.2, 0.1, 0] : [0.1, -0.2, 0.1],
          tiedUmaPolicy, terminalRiichiPoolPolicy,
        }, count === 4 ? [39000, 25000, 25000, 10000] : [49000, 27500, 27500], 1000);
      }
    }
  }
  terminal('terminal_zero_not_bust', 4, { targetPoints: 50000 }, [0, 40000, 30000, 30000], 0,
    { requireTargetPoints: true });
  terminal('terminal_wrc_unallocated', 4, { ...engine.WRC_4P_REF_V1 }, [40000, 40000, 20000, 18000], 2000,
    { completedSouth4: true, startingDealerSeatNo: 1 });
  terminal('terminal_oka_tenths', 4, { returnPoints: 30100, oka: 20.4 }, [32100, 28900, 21100, 17900]);
  terminal('terminal_fixed_south4_pending', 4, { fixedSouth4EndPolicy: 'completed_south_4' },
    [40000, 25000, 20000, 15000], 0, { completedSouth4: false });
  terminal('terminal_fixed_south4_complete', 4, { fixedSouth4EndPolicy: 'completed_south_4' },
    [40000, 25000, 20000, 15000], 0, { completedSouth4: true });
  terminal('terminal_nonended', 4, { targetPoints: 50000 }, [30000, 30000, 20000, 19000], 1000,
    { requireTargetPoints: true });
  let rotation = hand(4, { roundWind: 'S', roundNumber: 1 });
  for (let round = 1; round <= 4; round++) {
    const settled = settle('fixed_south4_rotation_hand', 4,
      { fixedSouth4EndPolicy: 'completed_south_4' }, rotation, {
        kind: 'ron', winners: [win((rotation.dealerSeatNo + 1) % 4, rotation.dealerSeatNo, 1, 30)],
      });
    rotation = { ...rotation, ...settled.nextHand,
      seats: rotation.seats.map((seat) => ({
        ...seat, points: seat.points + settled.perSeat.find((row) => row.seatNo === seat.seatNo).netPoints,
      })),
    };
    const points = rotation.seats.map((seat) => seat.points);
    terminal('fixed_south4_rotation_pending', 4,
      { fixedSouth4EndPolicy: 'completed_south_4' }, points, rotation.riichiPool,
      { completedSouth4: false });
    if (round === 4) {
      terminal('fixed_south4_rotation_complete', 4,
        { fixedSouth4EndPolicy: 'completed_south_4' }, points, rotation.riichiPool,
        { completedSouth4: true });
    }
  }

  // Automatic-end decisions use real settlement outputs and post-hand balances.
  function automatic(category, config, before, result) {
    const snapshot = rules(3, config);
    const settled = settle(`${category}_hand`, 3, config, before, result);
    const after = before.seats.map((seat) => ({
      seatNo: seat.seatNo,
      points: seat.points + settled.perSeat.find((p) => p.seatNo === seat.seatNo).netPoints,
    }));
    invoke(category, 3, () => engine.isAutomaticMatchEnd(snapshot.config, before, result, settled.nextHand, after));
  }
  const south3 = { roundWind: 'S', roundNumber: 3, dealerSeatNo: 0 };
  automatic('auto_south3_dealer_35k', { automaticEndPolicy: 'ranked_sanma' },
    hand(3, { ...south3, seatPoints: [33000, 36000, 36000] }),
    { kind: 'tsumo', winners: [{ seatNo: 0, han: 2, fu: 30 }] });
  automatic('auto_south3_below_40k', { automaticEndPolicy: 'ranked_sanma' },
    hand(3, { ...south3, seatPoints: [37000, 38000, 30000] }),
    { kind: 'ron', winners: [win(1, 0, 1, 30)] });
  automatic('auto_south3_40k_candidate', { automaticEndPolicy: 'ranked_sanma' },
    hand(3, { ...south3, seatPoints: [36000, 39000, 30000] }),
    { kind: 'ron', winners: [win(1, 0, 1, 30)] });
  automatic('auto_west3_cap', { automaticEndPolicy: 'ranked_sanma' },
    hand(3, { roundWind: 'W', roundNumber: 3 }), draw([false, false, false]));
  automatic('auto_manual', { automaticEndPolicy: 'manual' },
    hand(3, { ...south3, seatPoints: [36000, 39000, 30000] }),
    { kind: 'ron', winners: [win(1, 0, 1, 30)] });
  automatic('auto_south3_dealer_tenpai', { automaticEndPolicy: 'ranked_sanma' },
    hand(3, { ...south3, seatPoints: [36000, 35000, 34000] }), draw([true, false, false]));

  // A three-hand ledger: apply each real nextHand and per-seat net delta.
  let current = hand(4);
  const trajectory = [
    { result: draw([true, false, false, false]), riichiSeats: [0] },
    { result: { kind: 'ron', winners: [win(2, 0)] }, riichiSeats: [1] },
    { result: { kind: 'tsumo', winners: [{ seatNo: 1, han: 3, fu: 40 }] }, riichiSeats: [] },
  ];
  for (const [index, step] of trajectory.entries()) {
    current = { ...current, handId: `trajectory-${index + 1}`,
      seats: current.seats.map((seat) => ({ ...seat, isRiichi: step.riichiSeats.includes(seat.seatNo) })),
    };
    const settled = settle(`trajectory_hand_${index + 1}`, 4, {}, current, step.result);
    current = { ...current, ...settled.nextHand,
      seats: current.seats.map((seat) => ({ ...seat,
        points: seat.points + settled.perSeat.find((p) => p.seatNo === seat.seatNo).netPoints,
        isRiichi: false, isTenpai: false,
      })),
    };
  }
  terminal('trajectory_terminal', 4, {}, current.seats.map((seat) => seat.points), current.riichiPool);

  // Alias resolution, defaults, nullable fields, rejected dimensions, and the
  // upper edge of PostgreSQL int4 values are all distinct normalization calls.
  for (const [category, config] of [
    ['normalize_empty', {}],
    ['normalize_aliases', { players: 3, startPoints: 35000, baseReturnPoints: 40000,
      goalPoints: 40000, umaTenths: [200, 0, -200], headBump: true,
      tsumoPaymentMode: 'tsumo_loss', honba: { ron: 200 }, nagashiTakesPool: true }],
    ['normalize_missing_fields', { playerCount: 4, templateKey: 'wrc_4p_ref_v1' }],
    ['normalize_null_enum_defaults', { playerCount: 4, multiRon: null, honba: null,
      doubleRonHonbaPolicy: null, tiedUmaPolicy: null }],
    ['normalize_invalid_enums_fallback', { playerCount: 4, multiRon: 'other',
      doubleRonHonbaPolicy: 'other', tiedUmaPolicy: 'other', automaticEndPolicy: 'other' }],
    ['normalize_upper_int4', { playerCount: 4, startingPoints: 2147483600,
      returnPoints: 2147483600, targetPoints: 2147483600 }],
  ]) {
    const count = config.players ?? config.playerCount ?? 4;
    invoke(category, count, () => engine.normalizeRulesConfig(config));
  }
  expectedError('normalize_bad_count', 4, () => engine.normalizeRulesConfig({ playerCount: 5 }), /playerCount/);
  expectedError('normalize_null_number', 4, () => engine.normalizeRulesConfig({ startingPoints: null }), /startingPoints/);
  expectedError('normalize_null_boolean', 4, () => engine.normalizeRulesConfig({ kiriageMangan: null }), /kiriageMangan/);
  expectedError('normalize_over_int4', 4, () => engine.normalizeRulesConfig({ startingPoints: 2147483700 }), /startingPoints/);
  expectedError('normalize_bad_uma', 4, () => engine.normalizeRulesConfig({ umaTenths: [1, 0, 0, 0] }), /uma/);
  expectedError('low_point_riichi_disallowed', 4, () => engine.calculateSettlement(
    rules(4), hand(4, { seatPoints: [900, 25000, 25000, 25000], riichiSeats: [0] }),
    { kind: 'ron', winners: [win(1, 2)] }, version,
  ), /cannot confirm riichi/);
  settle('low_point_riichi_allowed', 4, { allowLowPointRiichi: true },
    hand(4, { seatPoints: [900, 25000, 25000, 25000], riichiSeats: [0] }),
    { kind: 'ron', winners: [win(1, 2)] });
  expectedError('low_point_riichi_disallowed', 3, () => engine.calculateSettlement(
    rules(3), hand(3, { seatPoints: [900, 35000, 35000], riichiSeats: [0] }),
    { kind: 'ron', winners: [win(1, 2)] }, version,
  ), /cannot confirm riichi/);
  settle('low_point_riichi_allowed', 3, { allowLowPointRiichi: true },
    hand(3, { seatPoints: [900, 35000, 35000], riichiSeats: [0] }),
    { kind: 'ron', winners: [win(1, 2)] });
}
