// Отладочный оверлей (клавиша ~): fps, полигоны, координаты, состояние.

export function makeDebug() {
  return { on: false, fps: 60, acc: 0, frames: 0 };
}

export function tickDebug(dbg, dt) {
  dbg.acc += dt;
  dbg.frames++;
  if (dbg.acc >= 0.5) {
    dbg.fps = dbg.frames / dbg.acc;
    dbg.acc = 0;
    dbg.frames = 0;
  }
}

export function drawDebug(r, game, dbg) {
  if (!dbg.on) return;
  const ctx = r.ctx;
  const s = game.ship;
  const rs = game.renderStats || { polys: 0, items: 0, backend: '?' };
  const lines = [
    `fps ${dbg.fps.toFixed(0)}   ${rs.backend}: треугольников ${rs.polys}, вызовов ${rs.items}` +
      (rs.detail ? ', деталь на пиксель' : ''),
    rs.gpu ? `GPU ${rs.gpu}` : '',
    `pos ${s.pos.x.toFixed(1)} ${s.pos.y.toFixed(1)} ${s.pos.z.toFixed(1)}`,
    `speed ${s.speed.toFixed(4)} км/с  тяга ${s.throttle.toFixed(2)}  круиз x${game.cruise.level}`,
    `круиз лимит x${[1, 10, 100, 1000, 10000, 50000][game.cruise.limitedTo]}  masslock ${game.cruise.massLocked ? game.cruise.lockedBy.name : 'нет'}`,
    `rot ${s.rot.pitch.toFixed(3)} ${s.rot.yaw.toFixed(3)} ${s.rot.roll.toFixed(3)}`,
    `режим ${game.state.mode}  вид ${game.state.view}${s.vtol ? '  посадочный режим' : ''}`,
    rs.tiles
      ? `плитки: в кадре ${rs.tiles.drawn}, в кэше ${rs.tiles.tiles}, ` +
        `собрано ${rs.tiles.built}, вытеснено ${rs.tiles.evicted}` +
        (rs.tiles.pending ? `, в очереди ${rs.tiles.pending}` : '')
      : (rs.patches
        ? `заплатки поверхности: ${rs.patches} уровней, пересборок ${rs.patchBuilds}`
        : (rs.pending ? `мешей в очереди ${rs.pending}` : '')),
    game.zone
      ? `${game.zone.body.name}: высота ${(game.zone.alt * 1000).toFixed(0)} м, ` +
        `уклон ${(game.zone.slope * 57.3).toFixed(0)}°, шасси ${s.gear.t.toFixed(2)}`
      : '',
    game.nearest ? `ближайшее ${game.nearest.body.name} зазор ${game.nearest.gap.toFixed(1)} км` : '',
    game.dockAssist
      ? `порт x${game.dockAssist.q.local.x.toFixed(3)} y${game.dockAssist.q.local.y.toFixed(3)} z${game.dockAssist.q.local.z.toFixed(3)} align ${game.dockAssist.q.align.toFixed(2)} roll ${game.dockAssist.q.roll.toFixed(2)}`
      : '',
  ];
  ctx.save();
  ctx.font = '11px Consolas, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let y = 8;
  for (const l of lines) {
    if (!l) continue;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    const wid = ctx.measureText(l).width;
    ctx.fillRect(r.camera.w - wid - 14, y, wid + 10, 14);
    ctx.fillStyle = '#78e08f';
    ctx.fillText(l, r.camera.w - wid - 9, y + 2);
    y += 15;
  }
  ctx.restore();
}
