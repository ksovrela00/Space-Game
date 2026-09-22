// Отладочный оверлей (клавиша ~): fps, полигоны, координаты, состояние.

import { audioLine } from '../game/audio.js';

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
    // Цена кадра. Время карты — от таймера драйвера, а не от fps: при
    // синхронизации кадров fps стоит на шестидесяти, пока запас есть,
    // и по нему не видно, сколько его осталось.
    rs.frameMs
      ? `кадр ${rs.frameMs.toFixed(1)} мс` +
        (rs.gpuMs ? `, карта ${rs.gpuMs.toFixed(1)} мс` : ' (таймера карты нет)') +
        (rs.fw > 1.01 ? `, деталь мягче ×${rs.fw.toFixed(1)}` : ', деталь полная')
      : '',
    `pos ${s.pos.x.toFixed(1)} ${s.pos.y.toFixed(1)} ${s.pos.z.toFixed(1)}`,
    `speed ${s.speed.toFixed(4)} км/с  тяга ${s.throttle.toFixed(2)}` +
      `  форсаж ${(s.boost * 100).toFixed(0)}%${s.boosting ? ' (жмут)' : ''}`,
    game.quantum && game.quantum.phase !== 'idle'
      ? `привод ${game.quantum.phase} ${(game.quantum.calib * 100).toFixed(0)}%  ` +
        `${game.quantum.speed.toFixed(0)} км/с  остаток ${game.quantum.dist.toFixed(0)} км`
      : `привод выключен${game.quantum && game.quantum.reason ? ': ' + game.quantum.reason : ''}`,
    `rot ${s.rot.pitch.toFixed(3)} ${s.rot.yaw.toFixed(3)} ${s.rot.roll.toFixed(3)}`,
    `режим ${game.state.mode}  вид ${game.state.view}` +
      (s.lift ? `  подъём ${(s.lift * 1000).toFixed(1)} м/с²` : ''),
    game.capture
      ? `захват ${game.capture.name}: g ${game.capture.g0.toFixed(2)} м/с², ` +
        `сфера ${(game.capture.soi / game.capture.radius).toFixed(1)} радиусов`
      : 'вне захвата',
    rs.tiles
      ? `плитки: в кадре ${rs.tiles.drawn}, в кэше ${rs.tiles.tiles}, ` +
        `собрано ${rs.tiles.built}, вытеснено ${rs.tiles.evicted}` +
        (rs.tiles.pending ? `, в очереди ${rs.tiles.pending}` : '') +
        (rs.tiles.workers ? `, потоков ${rs.tiles.workers}` : ', СЧЁТ В КАДРЕ') +
        (rs.tiles.waiting ? `, ждут потомков ${rs.tiles.waiting}` : '')
      : (rs.patches
        ? `заплатки поверхности: ${rs.patches} уровней, пересборок ${rs.patchBuilds}`
        : (rs.pending ? `мешей в очереди ${rs.pending}` : '')),
    game.zone
      ? `${game.zone.body.name}: высота ${(game.zone.alt * 1000).toFixed(0)} м, ` +
        `уклон ${(game.zone.slope * 57.3).toFixed(0)}°, шасси ${s.gear.t.toFixed(2)}`
      : '',
    game.nearest ? `ближайшее ${game.nearest.body.name} зазор ${game.nearest.gap.toFixed(1)} км` : '',
    rs.rocks
      ? `камни: ${rs.rocks.count} в поле, нарисовано ${rs.rocks.drawn}, ` +
        `сборок ${rs.rocks.builds}   пыль: ${rs.dust} частиц`
      : '',
    game.entry
      ? `вход в атмосферу: нагрев ${(game.entry.heat * 100).toFixed(0)}%, ` +
        `обдув ${(game.entry.speed * 1000).toFixed(0)} м/с, плотность ` +
        `${game.entry.rho.toFixed(3)}, высота ${(game.entry.alt).toFixed(1)} км`
      : '',
    game.audio ? audioLine(game.audio, game.sound) : '',
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
