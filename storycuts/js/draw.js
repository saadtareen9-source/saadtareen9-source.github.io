// Procedural stick-figure renderer. Every scene is drawn from a small JSON
// description, so a character looks identical in every shot by construction.

const INK = '#141414';
const rad = (d) => (d * Math.PI) / 180;

// Angle convention: 0 = straight down, positive = towards the way the figure faces.
function dirVec(angleDeg, facing) {
  const a = rad(angleDeg);
  return [Math.sin(a) * facing, Math.cos(a)];
}

function twoBone(sx, sy, tx, ty, l1, l2, bend) {
  let dx = tx - sx, dy = ty - sy;
  let d = Math.hypot(dx, dy);
  const max = (l1 + l2) * 0.999;
  if (d > max) { dx *= max / d; dy *= max / d; d = max; }
  d = Math.max(d, 1e-3);
  const a = Math.acos(Math.min(1, Math.max(-1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))));
  const base = Math.atan2(dy, dx);
  const ex = sx + l1 * Math.cos(base + bend * a);
  const ey = sy + l1 * Math.sin(base + bend * a);
  return [ex, ey, sx + dx, sy + dy];
}

// Each pose returns limb angles [upper, lower] (or an IK target), torso lean,
// a whole-body rotation and small offsets. `t` is seconds into the shot.
function poseSpec(pose, t) {
  const s = (f, a) => Math.sin(t * f) * a;
  const stand = { armF: [12, 4], armB: [-12, -4], legF: [7, 0], legB: [-7, 0], lean: 0, bob: s(2, 0.006) };
  switch (pose) {
    case 'walk': {
      const w = s(7, 28);
      return { armF: [w * 0.8, w * 0.8 + 18], armB: [-w * 0.8, -w * 0.8 + 18], legF: [w, w - 6], legB: [-w, -w - 6], lean: 4, bob: Math.abs(s(7, 0.012)) };
    }
    case 'run': {
      const w = s(11, 48);
      return { armF: [w, w + 80], armB: [-w, -w + 80], legF: [w + 10, w - 45], legB: [-w + 10, -w - 45], lean: 16, bob: Math.abs(s(11, 0.03)) };
    }
    case 'point':
      return { ...stand, armF: [92 + s(3, 3), 90 + s(3, 3)] };
    case 'freeze':
      return { armF: [35, 35], armB: [-35, -35], legF: [12, 12], legB: [-12, -12], lean: -3, jitter: 0.004 };
    case 'arms_up':
      return { armF: [160, 175 + s(6, 10)], armB: [-160, -175 - s(6, 10)], legF: [10, 0], legB: [-10, 0], lean: -4, bob: Math.abs(s(6, 0.02)) };
    case 'sit':
      return { armF: [30, 80], armB: [10, 70], legF: [90, 0], legB: [86, -4], lean: -2, chair: true };
    case 'facepalm':
      return { ...stand, armF: { target: 'face', bend: 1 }, lean: 6 };
    case 'shrug':
      return { ...stand, armF: [55, 150], armB: [-55, -150], tilt: 8 };
    case 'fall':
      return { armF: [140 + s(9, 20), 160], armB: [-120 - s(9, 20), -150], legF: [30 + s(8, 25), 10], legB: [-20 - s(8, 25), -40], lean: 0, rot: 82, bob: 0 };
    case 'wave':
      return { ...stand, armF: [145 + s(9, 12), 175 + s(9, 28)] };
    case 'hold':
      return { ...stand, armF: [55, 95], armB: [40, 95] };
    case 'hands_on_hips':
      return { ...stand, armF: { target: 'hip', bend: -1 }, armB: { target: 'hip', bend: 1 }, legF: [12, 0], legB: [-12, 0] };
    case 'cower':
      return { armF: { target: 'head', bend: -1 }, armB: { target: 'head', bend: 1 }, legF: [70, -25], legB: [55, -35], lean: 22, jitter: 0.003 };
    case 'dance': {
      const p = Math.sin(t * 5) > 0;
      return {
        armF: p ? [150, 175] : [60, 120], armB: p ? [-60, -120] : [-150, -175],
        legF: p ? [25, -5] : [5, 0], legB: p ? [-5, 0] : [-25, 5], lean: s(5, 8), bob: Math.abs(s(10, 0.02)),
      };
    }
    case 'phone':
      return { ...stand, armF: { target: 'ear', bend: 1 } };
    default:
      return stand;
  }
}

function limb(ctx, x, y, spec, l1, l2, facing, targets) {
  let ex, ey, hx, hy;
  if (Array.isArray(spec)) {
    const [u, l] = spec;
    const [ux, uy] = dirVec(u, facing);
    ex = x + ux * l1; ey = y + uy * l1;
    const [lx, ly] = dirVec(l, facing);
    hx = ex + lx * l2; hy = ey + ly * l2;
  } else {
    const [tx, ty] = targets[spec.target];
    [ex, ey, hx, hy] = twoBone(x, y, tx, ty, l1, l2, spec.bend * facing);
  }
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy);
  ctx.stroke();
  return [hx, hy];
}

function legExtent(spec, l1, l2) {
  const [u, l] = spec;
  return Math.cos(rad(u)) * l1 + Math.cos(rad(l)) * l2;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawHair(ctx, ch, cx, cy, r, f) {
  const col = ch.hairColor || '#2b2b2b';
  ctx.save();
  ctx.fillStyle = col; ctx.strokeStyle = col;
  switch (ch.hair) {
    case 'spiky': {
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.95, cy - r * 0.25);
      for (let i = 0; i <= 6; i++) {
        const a = Math.PI + (i / 6) * Math.PI;
        const rr = i % 2 ? r * 1.5 : r * 1.02;
        ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill();
      break;
    }
    case 'short':
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.08, Math.PI * 1.02, Math.PI * 1.98); ctx.closePath(); ctx.fill();
      break;
    case 'long':
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.12, Math.PI * 0.95, Math.PI * 2.05); ctx.fill();
      ctx.fillRect(cx - r * 1.12, cy - r * 0.1, r * 0.35, r * 1.9);
      ctx.fillRect(cx + r * 0.77, cy - r * 0.1, r * 0.35, r * 1.9);
      break;
    case 'bun':
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.08, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
      ctx.beginPath(); ctx.arc(cx - f * r * 0.15, cy - r * 1.25, r * 0.45, 0, Math.PI * 2); ctx.fill();
      break;
    case 'curly':
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * 0.9 + (i / 8) * Math.PI * 1.2;
        ctx.beginPath(); ctx.arc(cx + Math.cos(a) * r * 1.02, cy + Math.sin(a) * r * 1.02, r * 0.36, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'ponytail':
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.08, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx - f * r * 1.3, cy - r * 0.2, r * 0.55, r * 0.3, -f * 0.6, 0, Math.PI * 2); ctx.fill();
      break;
    case 'bald':
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = r * 0.08;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.7, Math.PI * 1.25, Math.PI * 1.5); ctx.stroke();
      break;
    default:
      break;
  }
  ctx.restore();
}

function drawAccessory(ctx, ch, cx, cy, r, f, lw, shoulder, hip) {
  ctx.save();
  ctx.lineWidth = lw * 0.7; ctx.strokeStyle = INK; ctx.fillStyle = INK;
  const ex = cx + f * r * 0.15;
  switch (ch.accessory) {
    case 'glasses':
      ctx.lineWidth = lw * 0.5;
      ctx.beginPath(); ctx.arc(ex - r * 0.3, cy - r * 0.1, r * 0.24, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.arc(ex + r * 0.3, cy - r * 0.1, r * 0.24, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ex - r * 0.06, cy - r * 0.12); ctx.lineTo(ex + r * 0.06, cy - r * 0.12); ctx.stroke();
      break;
    case 'hat':
      ctx.fillStyle = '#222';
      ctx.fillRect(cx - r * 1.3, cy - r * 0.95, r * 2.6, r * 0.25);
      ctx.fillRect(cx - r * 0.8, cy - r * 2.0, r * 1.6, r * 1.1);
      ctx.fillStyle = ch.color; ctx.fillRect(cx - r * 0.8, cy - r * 1.15, r * 1.6, r * 0.2);
      break;
    case 'cap':
      ctx.fillStyle = ch.color;
      ctx.beginPath(); ctx.arc(cx, cy - r * 0.1, r * 1.05, Math.PI, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(cx + f * r * 1.05, cy - r * 0.15, r * 0.7, r * 0.15, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case 'bow': {
      ctx.fillStyle = ch.color;
      const bx = cx - f * r * 0.55, by = cy - r * 0.95;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - r * 0.5, by - r * 0.3); ctx.lineTo(bx - r * 0.5, by + r * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + r * 0.5, by - r * 0.3); ctx.lineTo(bx + r * 0.5, by + r * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'tie': {
      const [sx, sy] = shoulder;
      const len = Math.hypot(hip[0] - sx, hip[1] - sy);
      const ang = Math.atan2(hip[1] - sy, hip[0] - sx) - Math.PI / 2;
      ctx.translate(sx, sy); ctx.rotate(ang);
      ctx.fillStyle = '#c0392b'; ctx.lineWidth = lw * 0.35;
      ctx.beginPath(); ctx.moveTo(-r * 0.15, r * 0.1); ctx.lineTo(r * 0.15, r * 0.1); ctx.lineTo(r * 0.25, len * 0.6); ctx.lineTo(0, len * 0.72); ctx.lineTo(-r * 0.25, len * 0.6); ctx.closePath(); ctx.fill(); ctx.stroke();
      break;
    }
    case 'beard':
      ctx.fillStyle = ch.hairColor || '#3a2a1a';
      ctx.beginPath(); ctx.arc(cx + f * r * 0.1, cy + r * 0.15, r * 0.95, Math.PI * 0.08, Math.PI * 0.92); ctx.fill();
      break;
    case 'mustache':
      ctx.fillStyle = ch.hairColor || '#3a2a1a';
      ctx.beginPath(); ctx.ellipse(ex - r * 0.17, cy + r * 0.28, r * 0.22, r * 0.09, 0.2, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(ex + r * 0.17, cy + r * 0.28, r * 0.22, r * 0.09, -0.2, 0, Math.PI * 2); ctx.fill();
      break;
    case 'headphones':
      ctx.lineWidth = lw * 0.7; ctx.strokeStyle = '#333';
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.15, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.fillStyle = ch.color;
      roundRect(ctx, cx - r * 1.3, cy - r * 0.35, r * 0.35, r * 0.7, r * 0.12); ctx.fill(); ctx.stroke();
      roundRect(ctx, cx + r * 0.95, cy - r * 0.35, r * 0.35, r * 0.7, r * 0.12); ctx.fill(); ctx.stroke();
      break;
    default:
      break;
  }
  ctx.restore();
}

function drawFace(ctx, expr, cx, cy, r, f, lw, t) {
  const ex = cx + f * r * 0.18;
  const eyeY = cy - r * 0.12;
  const eL = ex - r * 0.3, eR = ex + r * 0.3;
  ctx.save();
  ctx.lineWidth = lw * 0.55; ctx.strokeStyle = INK; ctx.fillStyle = INK;
  const dot = (x, y, s = 0.11) => { ctx.beginPath(); ctx.arc(x, y, r * s, 0, Math.PI * 2); ctx.fill(); };
  const blink = (Math.floor(t * 10) % 37) === 0;
  switch (expr) {
    case 'happy':
    case 'laughing':
      ctx.beginPath(); ctx.arc(eL, eyeY + r * 0.05, r * 0.12, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(eR, eyeY + r * 0.05, r * 0.12, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      break;
    case 'shocked':
    case 'scared':
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(eL, eyeY, r * 0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.arc(eR, eyeY, r * 0.2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = INK; dot(eL, eyeY, 0.07); dot(eR, eyeY, 0.07);
      break;
    case 'crying':
    case 'sad':
      ctx.beginPath(); ctx.arc(eL, eyeY + r * 0.02, r * 0.12, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
      ctx.beginPath(); ctx.arc(eR, eyeY + r * 0.02, r * 0.12, Math.PI * 0.1, Math.PI * 0.9); ctx.stroke();
      break;
    default:
      if (blink) { ctx.beginPath(); ctx.moveTo(eL - r * 0.1, eyeY); ctx.lineTo(eL + r * 0.1, eyeY); ctx.moveTo(eR - r * 0.1, eyeY); ctx.lineTo(eR + r * 0.1, eyeY); ctx.stroke(); }
      else { dot(eL, eyeY); dot(eR, eyeY); }
  }
  // brows
  ctx.beginPath();
  if (expr === 'angry') {
    ctx.moveTo(eL - r * 0.2, eyeY - r * 0.3); ctx.lineTo(eL + r * 0.15, eyeY - r * 0.15);
    ctx.moveTo(eR + r * 0.2, eyeY - r * 0.3); ctx.lineTo(eR - r * 0.15, eyeY - r * 0.15);
  } else if (expr === 'sad' || expr === 'scared' || expr === 'crying') {
    ctx.moveTo(eL - r * 0.18, eyeY - r * 0.2); ctx.lineTo(eL + r * 0.12, eyeY - r * 0.33);
    ctx.moveTo(eR + r * 0.18, eyeY - r * 0.2); ctx.lineTo(eR - r * 0.12, eyeY - r * 0.33);
  } else if (expr === 'confused') {
    ctx.moveTo(eL - r * 0.15, eyeY - r * 0.28); ctx.lineTo(eL + r * 0.15, eyeY - r * 0.28);
    ctx.moveTo(eR - r * 0.15, eyeY - r * 0.42); ctx.lineTo(eR + r * 0.15, eyeY - r * 0.3);
  } else if (expr === 'smug') {
    ctx.moveTo(eL - r * 0.15, eyeY - r * 0.22); ctx.lineTo(eL + r * 0.15, eyeY - r * 0.22);
    ctx.moveTo(eR - r * 0.15, eyeY - r * 0.3); ctx.lineTo(eR + r * 0.15, eyeY - r * 0.36);
  } else if (expr === 'shocked') {
    ctx.moveTo(eL - r * 0.15, eyeY - r * 0.4); ctx.lineTo(eL + r * 0.15, eyeY - r * 0.44);
    ctx.moveTo(eR - r * 0.15, eyeY - r * 0.44); ctx.lineTo(eR + r * 0.15, eyeY - r * 0.4);
  }
  ctx.stroke();
  // mouth
  const mx = ex, my = cy + r * 0.42;
  ctx.beginPath();
  switch (expr) {
    case 'happy': ctx.arc(mx, my - r * 0.12, r * 0.28, Math.PI * 0.15, Math.PI * 0.85); ctx.stroke(); break;
    case 'laughing': {
      const open = r * (0.16 + Math.abs(Math.sin(t * 14)) * 0.08);
      ctx.moveTo(mx - r * 0.3, my - r * 0.08); ctx.quadraticCurveTo(mx, my + open * 2, mx + r * 0.3, my - r * 0.08); ctx.closePath();
      ctx.fillStyle = '#7a1f1f'; ctx.fill(); ctx.stroke(); break;
    }
    case 'shocked':
    case 'scared':
      ctx.ellipse(mx, my, r * 0.13, r * 0.19, 0, 0, Math.PI * 2); ctx.fillStyle = INK; ctx.fill(); break;
    case 'angry':
      ctx.moveTo(mx - r * 0.25, my + r * 0.05); ctx.lineTo(mx - r * 0.08, my - r * 0.04); ctx.lineTo(mx + r * 0.08, my + r * 0.05); ctx.lineTo(mx + r * 0.25, my - r * 0.04); ctx.stroke(); break;
    case 'sad':
    case 'crying':
      ctx.arc(mx, my + r * 0.18, r * 0.22, Math.PI * 1.2, Math.PI * 1.8); ctx.stroke(); break;
    case 'confused':
      ctx.moveTo(mx - r * 0.22, my); ctx.quadraticCurveTo(mx - r * 0.05, my - r * 0.1, mx + r * 0.05, my); ctx.quadraticCurveTo(mx + r * 0.15, my + r * 0.1, mx + r * 0.25, my - r * 0.03); ctx.stroke(); break;
    case 'smug':
      ctx.moveTo(mx - r * 0.2, my); ctx.quadraticCurveTo(mx + r * 0.1, my + r * 0.08, mx + r * 0.28, my - r * 0.12); ctx.stroke(); break;
    default:
      ctx.moveTo(mx - r * 0.18, my); ctx.lineTo(mx + r * 0.18, my); ctx.stroke();
  }
  if (expr === 'crying') {
    ctx.fillStyle = '#4aa3df';
    const dy = ((t * 1.5) % 1) * r * 0.9;
    ctx.beginPath(); ctx.ellipse(eL, eyeY + r * 0.2 + dy, r * 0.06, r * 0.1, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(eR, eyeY + r * 0.25 + ((dy + r * 0.4) % (r * 0.9)), r * 0.06, r * 0.1, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/**
 * Draw a stick figure standing on (x, groundY).
 * Returns anchor points (head centre, head radius, hands) for effects and bubbles.
 */
export function drawCharacter(ctx, ch, { x, groundY, size, pose = 'stand', expression = 'neutral', facing = 'right', t = 0, seed = 0 }) {
  const f = facing === 'left' ? -1 : 1;
  const H = size * (ch.height || 1);
  const p = poseSpec(pose, t + seed);
  const r = H * 0.12;
  const lw = Math.max(2, H * 0.034);
  const legL1 = H * 0.22, legL2 = H * 0.21;
  const armL1 = H * 0.16, armL2 = H * 0.15;
  const torso = H * 0.3;

  let jx = 0, jy = 0;
  if (p.jitter) { jx = Math.sin(t * 60 + seed) * H * p.jitter; jy = Math.cos(t * 53 + seed) * H * p.jitter; }

  ctx.save();
  if (p.rot) {
    ctx.translate(x, groundY - H * 0.06);
    ctx.rotate(rad(-p.rot * f));
    ctx.translate(-x, -(groundY - H * 0.06));
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = lw;

  const ext = Math.max(legExtent(p.legF, legL1, legL2), legExtent(p.legB, legL1, legL2));
  const hipX = x + jx;
  const hipY = groundY - ext - (p.bob || 0) * H + jy;
  const [lx, ly] = dirVec(p.lean || 0, f);
  const shX = hipX - lx * torso, shY = hipY - ly * torso;
  const tilt = rad((p.tilt || 0) * f);
  const neck = r * 1.15;
  const headX = shX - lx * neck + Math.sin(tilt) * r * 0.2;
  const headY = shY - ly * neck;

  if (p.chair) {
    ctx.save(); ctx.lineWidth = lw * 0.8; ctx.strokeStyle = '#6b4f2a';
    const cy = groundY - legL2 * 0.98;
    ctx.beginPath();
    ctx.moveTo(hipX - f * H * 0.12, cy); ctx.lineTo(hipX + f * H * 0.2, cy);
    ctx.moveTo(hipX - f * H * 0.1, cy); ctx.lineTo(hipX - f * H * 0.1, groundY);
    ctx.moveTo(hipX + f * H * 0.18, cy); ctx.lineTo(hipX + f * H * 0.18, groundY);
    ctx.moveTo(hipX - f * H * 0.12, cy); ctx.lineTo(hipX - f * H * 0.14, cy - H * 0.3);
    ctx.stroke(); ctx.restore();
  }

  const targets = {
    face: [headX + f * r * 0.3, headY + r * 0.1],
    ear: [headX + f * r * 0.1, headY + r * 0.2],
    head: [headX, headY - r * 0.9],
    hip: [hipX + f * H * 0.02, hipY - torso * 0.05],
  };

  // back limbs first
  ctx.globalAlpha = 0.92;
  limb(ctx, hipX, hipY, p.legB, legL1, legL2, f, targets);
  const handB = limb(ctx, shX, shY + r * 0.15, p.armB, armL1, armL2, f, targets);
  ctx.globalAlpha = 1;

  // torso + shirt
  ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(hipX, hipY); ctx.stroke();
  ctx.save();
  ctx.strokeStyle = ch.color || '#e4572e'; ctx.lineWidth = r * 0.95;
  ctx.beginPath();
  ctx.moveTo(shX + (hipX - shX) * 0.12, shY + (hipY - shY) * 0.12);
  ctx.lineTo(shX + (hipX - shX) * 0.82, shY + (hipY - shY) * 0.82);
  ctx.stroke();
  ctx.restore();
  ctx.beginPath(); ctx.moveTo(shX, shY); ctx.lineTo(headX, headY + r); ctx.stroke();

  limb(ctx, hipX, hipY, p.legF, legL1, legL2, f, targets);

  // head
  if (ch.hair === 'long' || ch.hair === 'ponytail') drawHair(ctx, ch, headX, headY, r, f);
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(headX, headY, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  if (!(ch.hair === 'long' || ch.hair === 'ponytail')) drawHair(ctx, ch, headX, headY, r, f);
  else {
    ctx.save(); ctx.fillStyle = ch.hairColor || '#2b2b2b';
    ctx.beginPath(); ctx.arc(headX, headY, r * 1.06, Math.PI * 1.05, Math.PI * 1.95); ctx.fill(); ctx.restore();
  }
  drawFace(ctx, expression, headX, headY, r, f, lw, t + seed);
  drawAccessory(ctx, ch, headX, headY, r, f, lw, [shX, shY], [hipX, hipY]);

  const handF = limb(ctx, shX, shY + r * 0.15, p.armF, armL1, armL2, f, targets);
  ctx.restore();

  // anchors in un-rotated space (good enough for bubbles on a fallen figure)
  return { head: [headX, headY], r, handF, handB, top: headY - r * 1.6, x, H };
}

// ---------- settings ----------

function sky(ctx, w, h, top, bottom) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}

function floor(ctx, w, h, gy, color, line = '#333') {
  ctx.fillStyle = color; ctx.fillRect(0, gy, w, h - gy);
  ctx.strokeStyle = line; ctx.lineWidth = Math.max(2, h * 0.003);
  ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(w, gy); ctx.stroke();
}

function windowFrame(ctx, x, y, ww, wh, u, night = false) {
  ctx.fillStyle = night ? '#1d2b53' : '#bfe6ff';
  ctx.fillRect(x, y, ww, wh);
  ctx.strokeStyle = '#555'; ctx.lineWidth = 6 * u;
  ctx.strokeRect(x, y, ww, wh);
  ctx.beginPath(); ctx.moveTo(x + ww / 2, y); ctx.lineTo(x + ww / 2, y + wh); ctx.moveTo(x, y + wh / 2); ctx.lineTo(x + ww, y + wh / 2); ctx.stroke();
}

function tree(ctx, x, gy, s) {
  ctx.fillStyle = '#8b5a2b'; ctx.fillRect(x - s * 0.06, gy - s * 0.5, s * 0.12, s * 0.5);
  ctx.fillStyle = '#4caf50';
  for (const [dx, dy, rr] of [[0, -0.75, 0.3], [-0.2, -0.6, 0.22], [0.2, -0.6, 0.22]]) {
    ctx.beginPath(); ctx.arc(x + dx * s, gy + dy * s, rr * s, 0, Math.PI * 2); ctx.fill();
  }
}

export function drawSetting(ctx, w, h, setting, gy, t = 0) {
  const u = Math.min(w, h) / 1000;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (setting) {
    case 'kitchen': {
      sky(ctx, w, h, '#fff6e5', '#ffe9c7');
      floor(ctx, w, h, gy, '#e8d3b0');
      // tiles
      ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 2 * u;
      for (let y = gy - 520 * u; y < gy - 220 * u; y += 60 * u) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
      // counter + cabinets
      ctx.fillStyle = '#c98b52'; ctx.fillRect(0, gy - 230 * u, w * 0.32, 230 * u);
      ctx.fillStyle = '#777'; ctx.fillRect(0, gy - 245 * u, w * 0.33, 18 * u);
      ctx.fillStyle = '#c98b52'; ctx.fillRect(0, gy - 700 * u, w * 0.3, 200 * u);
      ctx.strokeStyle = '#7a4f28'; ctx.lineWidth = 4 * u;
      ctx.strokeRect(10 * u, gy - 690 * u, w * 0.14 - 10 * u, 180 * u); ctx.strokeRect(w * 0.15, gy - 690 * u, w * 0.14, 180 * u);
      // stove
      ctx.fillStyle = '#ddd'; ctx.fillRect(w * 0.82, gy - 240 * u, w * 0.18, 240 * u);
      ctx.fillStyle = '#333'; ctx.fillRect(w * 0.84, gy - 250 * u, w * 0.14, 14 * u);
      ctx.strokeStyle = '#555'; ctx.strokeRect(w * 0.85, gy - 180 * u, w * 0.12, 120 * u);
      // fridge
      ctx.fillStyle = '#f2f2f2'; ctx.strokeStyle = '#888'; ctx.lineWidth = 4 * u;
      ctx.fillRect(w * 0.36, gy - 520 * u, 170 * u, 520 * u); ctx.strokeRect(w * 0.36, gy - 520 * u, 170 * u, 520 * u);
      ctx.beginPath(); ctx.moveTo(w * 0.36, gy - 340 * u); ctx.lineTo(w * 0.36 + 170 * u, gy - 340 * u); ctx.stroke();
      break;
    }
    case 'living_room': {
      sky(ctx, w, h, '#eef3ff', '#dfe7fb');
      floor(ctx, w, h, gy, '#c9a77c');
      windowFrame(ctx, w * 0.62, gy - 640 * u, 260 * u, 220 * u, u);
      // couch
      ctx.fillStyle = '#8e6fd8';
      roundRect(ctx, w * 0.02, gy - 200 * u, 360 * u, 200 * u, 30 * u); ctx.fill();
      roundRect(ctx, w * 0.02, gy - 300 * u, 360 * u, 120 * u, 30 * u); ctx.fill();
      // tv
      ctx.fillStyle = '#222'; ctx.fillRect(w * 0.98 - 240 * u, gy - 420 * u, 240 * u, 140 * u);
      ctx.fillStyle = '#6b4f2a'; ctx.fillRect(w * 0.98 - 260 * u, gy - 260 * u, 280 * u, 260 * u);
      // rug
      ctx.fillStyle = 'rgba(200,60,60,0.25)'; ctx.beginPath(); ctx.ellipse(w / 2, gy + 60 * u, w * 0.3, 40 * u, 0, 0, Math.PI * 2); ctx.fill();
      break;
    }
    case 'bedroom': {
      sky(ctx, w, h, '#f3ecff', '#e4d9fb');
      floor(ctx, w, h, gy, '#b88d63');
      windowFrame(ctx, w * 0.06, gy - 640 * u, 240 * u, 220 * u, u);
      // bed
      ctx.fillStyle = '#6b4f2a'; ctx.fillRect(w * 0.98 - 420 * u, gy - 260 * u, 30 * u, 260 * u);
      ctx.fillStyle = '#fff'; ctx.fillRect(w * 0.98 - 400 * u, gy - 170 * u, 400 * u, 90 * u);
      ctx.fillStyle = '#4a90d9'; ctx.fillRect(w * 0.98 - 300 * u, gy - 175 * u, 300 * u, 100 * u);
      ctx.fillStyle = '#6b4f2a'; ctx.fillRect(w * 0.98 - 400 * u, gy - 85 * u, 400 * u, 85 * u);
      // lamp
      ctx.fillStyle = '#f7d774'; ctx.beginPath(); ctx.moveTo(w * 0.42, gy - 420 * u); ctx.lineTo(w * 0.42 + 100 * u, gy - 420 * u); ctx.lineTo(w * 0.42 + 75 * u, gy - 500 * u); ctx.lineTo(w * 0.42 + 25 * u, gy - 500 * u); ctx.fill();
      ctx.strokeStyle = '#555'; ctx.lineWidth = 6 * u; ctx.beginPath(); ctx.moveTo(w * 0.42 + 50 * u, gy - 420 * u); ctx.lineTo(w * 0.42 + 50 * u, gy); ctx.stroke();
      break;
    }
    case 'bathroom': {
      sky(ctx, w, h, '#e9fbff', '#d5f3fa');
      floor(ctx, w, h, gy, '#dfe6e9');
      ctx.strokeStyle = 'rgba(0,0,0,0.08)'; ctx.lineWidth = 2 * u;
      for (let x = 0; x < w; x += 70 * u) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, gy); ctx.stroke(); }
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#999'; ctx.lineWidth = 5 * u;
      roundRect(ctx, w * 0.02, gy - 160 * u, 380 * u, 160 * u, 40 * u); ctx.fill(); ctx.stroke();
      ctx.fillRect(w * 0.98 - 160 * u, gy - 140 * u, 120 * u, 140 * u); ctx.strokeRect(w * 0.98 - 160 * u, gy - 140 * u, 120 * u, 140 * u);
      ctx.fillStyle = '#bfe6ff'; ctx.fillRect(w * 0.98 - 180 * u, gy - 520 * u, 160 * u, 220 * u); ctx.strokeRect(w * 0.98 - 180 * u, gy - 520 * u, 160 * u, 220 * u);
      break;
    }
    case 'office': {
      sky(ctx, w, h, '#f4f6f8', '#e3e8ec');
      floor(ctx, w, h, gy, '#9aa5ad');
      windowFrame(ctx, w * 0.08, gy - 680 * u, 300 * u, 260 * u, u);
      ctx.fillStyle = '#7a5a3a'; ctx.fillRect(w * 0.98 - 380 * u, gy - 200 * u, 380 * u, 26 * u);
      ctx.fillRect(w * 0.98 - 370 * u, gy - 175 * u, 20 * u, 175 * u); ctx.fillRect(w * 0.98 - 30 * u, gy - 175 * u, 20 * u, 175 * u);
      ctx.fillStyle = '#222'; ctx.fillRect(w * 0.98 - 270 * u, gy - 360 * u, 200 * u, 130 * u);
      ctx.fillStyle = '#5dade2'; ctx.fillRect(w * 0.98 - 260 * u, gy - 350 * u, 180 * u, 110 * u);
      ctx.fillStyle = '#222'; ctx.fillRect(w * 0.98 - 185 * u, gy - 230 * u, 30 * u, 30 * u);
      // clock
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#333'; ctx.lineWidth = 5 * u;
      ctx.beginPath(); ctx.arc(w * 0.6, gy - 640 * u, 50 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w * 0.6, gy - 640 * u); ctx.lineTo(w * 0.6, gy - 675 * u); ctx.moveTo(w * 0.6, gy - 640 * u); ctx.lineTo(w * 0.6 + 25 * u, gy - 640 * u); ctx.stroke();
      break;
    }
    case 'school': {
      sky(ctx, w, h, '#fffbe8', '#fdf1c7');
      floor(ctx, w, h, gy, '#c8a26e');
      ctx.fillStyle = '#2f5d3a'; ctx.strokeStyle = '#8b5a2b'; ctx.lineWidth = 14 * u;
      ctx.fillRect(w * 0.1, gy - 700 * u, w * 0.8, 300 * u); ctx.strokeRect(w * 0.1, gy - 700 * u, w * 0.8, 300 * u);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 5 * u;
      ctx.beginPath(); ctx.moveTo(w * 0.15, gy - 620 * u); ctx.lineTo(w * 0.4, gy - 620 * u); ctx.moveTo(w * 0.15, gy - 560 * u); ctx.lineTo(w * 0.5, gy - 560 * u); ctx.moveTo(w * 0.15, gy - 500 * u); ctx.lineTo(w * 0.32, gy - 500 * u); ctx.stroke();
      ctx.fillStyle = '#d4a15a'; ctx.fillRect(w * 0.02, gy - 150 * u, 180 * u, 20 * u); ctx.fillRect(w * 0.98 - 180 * u, gy - 150 * u, 180 * u, 20 * u);
      ctx.fillRect(w * 0.02 + 10 * u, gy - 130 * u, 14 * u, 130 * u); ctx.fillRect(w * 0.98 - 24 * u, gy - 130 * u, 14 * u, 130 * u);
      break;
    }
    case 'street': {
      sky(ctx, w, h, '#a8dcff', '#e3f4ff');
      const cols = ['#f4a261', '#e76f51', '#2a9d8f', '#e9c46a', '#8ab17d'];
      let x = -40 * u, i = 0;
      while (x < w) {
        const bw = (180 + (i * 53) % 90) * u, bh = (380 + (i * 97) % 300) * u;
        ctx.fillStyle = cols[i % cols.length]; ctx.fillRect(x, gy - bh, bw, bh);
        ctx.fillStyle = 'rgba(255,255,255,0.7)';
        for (let wy = gy - bh + 30 * u; wy < gy - 80 * u; wy += 80 * u)
          for (let wx = x + 25 * u; wx < x + bw - 40 * u; wx += 60 * u) ctx.fillRect(wx, wy, 30 * u, 40 * u);
        x += bw + 10 * u; i++;
      }
      floor(ctx, w, h, gy, '#777');
      ctx.fillStyle = '#fff';
      for (let lx = 0; lx < w; lx += 160 * u) ctx.fillRect(lx, gy + 70 * u, 80 * u, 10 * u);
      break;
    }
    case 'park': {
      sky(ctx, w, h, '#8fd3ff', '#dff4ff');
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(w * 0.85, h * 0.12, 70 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff';
      const cx = ((t * 15 * u) % (w + 300 * u)) - 150 * u;
      for (const [dx, rr] of [[0, 40], [45, 55], [95, 40]]) { ctx.beginPath(); ctx.arc(cx + dx * u, h * 0.18, rr * u, 0, Math.PI * 2); ctx.fill(); }
      floor(ctx, w, h, gy, '#7ac36a', '#4c8a3f');
      tree(ctx, w * 0.1, gy, 420 * u); tree(ctx, w * 0.92, gy, 360 * u);
      ctx.fillStyle = '#8b5a2b'; ctx.fillRect(w * 0.62, gy - 90 * u, 200 * u, 18 * u);
      ctx.fillRect(w * 0.62 + 10 * u, gy - 75 * u, 12 * u, 75 * u); ctx.fillRect(w * 0.62 + 178 * u, gy - 75 * u, 12 * u, 75 * u);
      break;
    }
    case 'store': {
      sky(ctx, w, h, '#fbfbfb', '#eeeeee');
      floor(ctx, w, h, gy, '#d9d9d9');
      const items = ['#e74c3c', '#f1c40f', '#3498db', '#2ecc71', '#9b59b6'];
      for (const sx of [w * 0.02, w * 0.98 - 300 * u]) {
        ctx.fillStyle = '#b0b0b0'; ctx.fillRect(sx, gy - 560 * u, 300 * u, 560 * u);
        for (let row = 0; row < 4; row++) {
          ctx.fillStyle = '#888'; ctx.fillRect(sx, gy - 560 * u + row * 140 * u + 120 * u, 300 * u, 10 * u);
          for (let k = 0; k < 6; k++) { ctx.fillStyle = items[(row + k) % items.length]; ctx.fillRect(sx + 12 * u + k * 48 * u, gy - 560 * u + row * 140 * u + 50 * u, 36 * u, 70 * u); }
        }
      }
      break;
    }
    case 'restaurant': {
      sky(ctx, w, h, '#fff0e6', '#ffe0cc');
      floor(ctx, w, h, gy, '#a0522d');
      for (const lx of [w * 0.25, w * 0.75]) {
        ctx.strokeStyle = '#333'; ctx.lineWidth = 3 * u; ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, gy - 600 * u); ctx.stroke();
        ctx.fillStyle = '#f39c12'; ctx.beginPath(); ctx.arc(lx, gy - 560 * u, 50 * u, Math.PI, 0); ctx.fill();
      }
      ctx.fillStyle = '#fff'; ctx.fillRect(w * 0.02, gy - 180 * u, 260 * u, 30 * u);
      ctx.fillStyle = '#c0392b'; ctx.fillRect(w * 0.02, gy - 155 * u, 260 * u, 20 * u);
      ctx.fillStyle = '#6b4f2a'; ctx.fillRect(w * 0.02 + 120 * u, gy - 135 * u, 20 * u, 135 * u);
      break;
    }
    case 'car': {
      sky(ctx, w, h, '#8fd3ff', '#e3f4ff');
      const scroll = (t * 400 * u) % (300 * u);
      ctx.fillStyle = '#7ac36a'; ctx.fillRect(0, gy - 120 * u, w, 120 * u);
      for (let x = -scroll; x < w + 300 * u; x += 300 * u) tree(ctx, x, gy - 100 * u, 200 * u);
      floor(ctx, w, h, gy, '#666');
      ctx.fillStyle = '#ffd34d';
      for (let x = -((t * 900 * u) % (200 * u)); x < w; x += 200 * u) ctx.fillRect(x, gy + 60 * u, 100 * u, 10 * u);
      break;
    }
    case 'beach': {
      sky(ctx, w, h, '#6ec6ff', '#d6f0ff');
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.arc(w * 0.8, h * 0.13, 80 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#2e86de'; ctx.fillRect(0, gy - 160 * u, w, 160 * u);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 4 * u; ctx.beginPath();
      for (let x = 0; x < w; x += 20 * u) ctx.lineTo(x, gy - 160 * u + Math.sin(x / (40 * u) + t * 2) * 8 * u);
      ctx.stroke();
      floor(ctx, w, h, gy, '#f5deb3', '#d2b48c');
      ctx.fillStyle = '#e74c3c'; ctx.beginPath(); ctx.moveTo(w * 0.08, gy - 330 * u); ctx.arc(w * 0.08 + 150 * u, gy - 330 * u, 150 * u, Math.PI, 0); ctx.fill();
      ctx.strokeStyle = '#555'; ctx.lineWidth = 6 * u; ctx.beginPath(); ctx.moveTo(w * 0.08 + 150 * u, gy - 330 * u); ctx.lineTo(w * 0.08 + 150 * u, gy); ctx.stroke();
      break;
    }
    case 'night': {
      sky(ctx, w, h, '#0b1736', '#1f3a68');
      ctx.fillStyle = '#fff';
      for (let i = 0; i < 40; i++) {
        const sx = ((i * 7919) % 1000) / 1000 * w, sy = ((i * 104729) % 1000) / 1000 * gy * 0.6;
        const tw = 0.5 + 0.5 * Math.sin(t * 3 + i);
        ctx.globalAlpha = 0.4 + tw * 0.6; ctx.fillRect(sx, sy, 5 * u, 5 * u);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f5f3ce'; ctx.beginPath(); ctx.arc(w * 0.82, h * 0.12, 70 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#0b1736'; ctx.beginPath(); ctx.arc(w * 0.82 + 30 * u, h * 0.12 - 15 * u, 60 * u, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#16213e';
      ctx.fillRect(0, gy - 300 * u, 260 * u, 300 * u); ctx.fillRect(w - 300 * u, gy - 380 * u, 300 * u, 380 * u);
      ctx.fillStyle = '#ffd34d'; ctx.fillRect(60 * u, gy - 240 * u, 50 * u, 60 * u); ctx.fillRect(w - 200 * u, gy - 300 * u, 50 * u, 60 * u);
      floor(ctx, w, h, gy, '#26323f', '#111');
      break;
    }
    case 'party': {
      sky(ctx, w, h, '#2c1a4d', '#4b2c7a');
      floor(ctx, w, h, gy, '#3d2a5c', '#111');
      const lc = ['#ff4d6d', '#ffd60a', '#4cc9f0', '#80ed99'];
      for (let i = 0; i < 4; i++) {
        ctx.globalAlpha = 0.25 + 0.15 * Math.sin(t * 4 + i * 2);
        ctx.fillStyle = lc[i];
        ctx.beginPath(); ctx.moveTo(w * (0.15 + i * 0.23), 0); ctx.lineTo(w * (0.05 + i * 0.23), gy); ctx.lineTo(w * (0.3 + i * 0.23), gy); ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (let i = 0; i < 12; i++) {
        ctx.fillStyle = lc[i % 4];
        ctx.beginPath(); ctx.moveTo(i * w / 11, 30 * u); ctx.lineTo(i * w / 11 + 30 * u, 30 * u); ctx.lineTo(i * w / 11 + 15 * u, 80 * u); ctx.fill();
      }
      break;
    }
    case 'hospital': {
      sky(ctx, w, h, '#f0fbf7', '#dff5ec');
      floor(ctx, w, h, gy, '#cfe3dc');
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#999'; ctx.lineWidth = 5 * u;
      ctx.fillRect(w * 0.98 - 420 * u, gy - 170 * u, 420 * u, 70 * u); ctx.strokeRect(w * 0.98 - 420 * u, gy - 170 * u, 420 * u, 70 * u);
      ctx.beginPath(); ctx.moveTo(w * 0.98 - 410 * u, gy - 100 * u); ctx.lineTo(w * 0.98 - 410 * u, gy); ctx.moveTo(w * 0.98 - 10 * u, gy - 100 * u); ctx.lineTo(w * 0.98 - 10 * u, gy); ctx.stroke();
      ctx.fillStyle = '#e74c3c';
      ctx.fillRect(w * 0.12, gy - 620 * u, 120 * u, 36 * u); ctx.fillRect(w * 0.12 + 42 * u, gy - 662 * u, 36 * u, 120 * u);
      break;
    }
    default: {
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#222'; ctx.lineWidth = Math.max(2, 4 * u);
      ctx.beginPath(); ctx.moveTo(w * 0.05, gy); ctx.lineTo(w * 0.95, gy); ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------- props ----------

export function drawProp(ctx, kind, x, gy, u, t = 0) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = INK; ctx.lineWidth = 5 * u;
  const box = (bx, by, bw, bh, fill) => { ctx.fillStyle = fill; ctx.fillRect(bx, by, bw, bh); ctx.strokeRect(bx, by, bw, bh); };
  switch (kind) {
    case 'door':
      box(x - 90 * u, gy - 420 * u, 180 * u, 420 * u, '#a0522d');
      ctx.fillStyle = '#f1c40f'; ctx.beginPath(); ctx.arc(x + 55 * u, gy - 200 * u, 12 * u, 0, Math.PI * 2); ctx.fill();
      break;
    case 'table':
      box(x - 150 * u, gy - 170 * u, 300 * u, 22 * u, '#b07a46');
      box(x - 135 * u, gy - 148 * u, 18 * u, 148 * u, '#b07a46'); box(x + 117 * u, gy - 148 * u, 18 * u, 148 * u, '#b07a46');
      break;
    case 'chair':
      box(x - 60 * u, gy - 110 * u, 120 * u, 16 * u, '#b07a46');
      box(x - 60 * u, gy - 260 * u, 16 * u, 260 * u, '#b07a46'); box(x + 44 * u, gy - 94 * u, 16 * u, 94 * u, '#b07a46');
      break;
    case 'stove':
      box(x - 110 * u, gy - 230 * u, 220 * u, 230 * u, '#dcdcdc');
      ctx.strokeRect(x - 80 * u, gy - 170 * u, 160 * u, 110 * u);
      ctx.fillStyle = '#333'; ctx.fillRect(x - 100 * u, gy - 245 * u, 200 * u, 14 * u);
      break;
    case 'pan':
      ctx.fillStyle = '#333';
      ctx.beginPath(); ctx.ellipse(x, gy - 260 * u, 80 * u, 22 * u, 0, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 12 * u; ctx.beginPath(); ctx.moveTo(x + 75 * u, gy - 262 * u); ctx.lineTo(x + 170 * u, gy - 280 * u); ctx.stroke();
      break;
    case 'phone':
      ctx.fillStyle = '#222'; roundRect(ctx, x - 25 * u, gy - 80 * u, 50 * u, 80 * u, 8 * u); ctx.fill();
      ctx.fillStyle = '#5dade2'; ctx.fillRect(x - 19 * u, gy - 72 * u, 38 * u, 60 * u);
      break;
    case 'cup':
      box(x - 25 * u, gy - 60 * u, 50 * u, 60 * u, '#fff');
      ctx.beginPath(); ctx.arc(x + 30 * u, gy - 30 * u, 15 * u, -Math.PI / 2, Math.PI / 2); ctx.stroke();
      break;
    case 'laptop':
      box(x - 80 * u, gy - 110 * u, 160 * u, 100 * u, '#555');
      ctx.fillStyle = '#5dade2'; ctx.fillRect(x - 68 * u, gy - 100 * u, 136 * u, 80 * u);
      box(x - 100 * u, gy - 12 * u, 200 * u, 12 * u, '#999');
      break;
    case 'book':
      box(x - 50 * u, gy - 30 * u, 100 * u, 30 * u, '#c0392b');
      break;
    case 'bag':
      box(x - 60 * u, gy - 100 * u, 120 * u, 100 * u, '#d35400');
      ctx.beginPath(); ctx.arc(x, gy - 100 * u, 35 * u, Math.PI, 0); ctx.stroke();
      break;
    case 'car': {
      ctx.fillStyle = '#e74c3c';
      roundRect(ctx, x - 230 * u, gy - 170 * u, 460 * u, 110 * u, 30 * u); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - 140 * u, gy - 170 * u); ctx.lineTo(x - 90 * u, gy - 260 * u); ctx.lineTo(x + 100 * u, gy - 260 * u); ctx.lineTo(x + 160 * u, gy - 170 * u); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#bfe6ff'; ctx.fillRect(x - 80 * u, gy - 245 * u, 75 * u, 65 * u); ctx.fillRect(x + 10 * u, gy - 245 * u, 85 * u, 65 * u);
      ctx.fillStyle = '#222';
      for (const wx of [-130, 130]) { ctx.beginPath(); ctx.arc(x + wx * u, gy - 50 * u, 50 * u, 0, Math.PI * 2); ctx.fill(); }
      break;
    }
    case 'dog':
    case 'cat': {
      const cat = kind === 'cat';
      ctx.fillStyle = cat ? '#f39c12' : '#c69c6d';
      ctx.beginPath(); ctx.ellipse(x, gy - 70 * u, 75 * u, 38 * u, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      for (const lx of [-45, -20, 25, 50]) { ctx.beginPath(); ctx.moveTo(x + lx * u, gy - 45 * u); ctx.lineTo(x + lx * u, gy); ctx.stroke(); }
      ctx.beginPath(); ctx.arc(x + 80 * u, gy - 115 * u, 36 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (cat) {
        ctx.beginPath(); ctx.moveTo(x + 55 * u, gy - 140 * u); ctx.lineTo(x + 62 * u, gy - 175 * u); ctx.lineTo(x + 80 * u, gy - 150 * u); ctx.moveTo(x + 85 * u, gy - 150 * u); ctx.lineTo(x + 102 * u, gy - 175 * u); ctx.lineTo(x + 108 * u, gy - 140 * u); ctx.stroke();
      } else {
        ctx.fillStyle = '#8b5a2b'; ctx.beginPath(); ctx.ellipse(x + 60 * u, gy - 110 * u, 14 * u, 30 * u, 0.3, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(x + 92 * u, gy - 120 * u, 5 * u, 0, Math.PI * 2); ctx.fill();
      const wag = Math.sin(t * (cat ? 3 : 14)) * 20 * u;
      ctx.beginPath(); ctx.moveTo(x - 72 * u, gy - 80 * u); ctx.quadraticCurveTo(x - 110 * u, gy - 110 * u, x - 115 * u + wag, gy - 150 * u); ctx.stroke();
      break;
    }
    case 'cake':
      box(x - 70 * u, gy - 90 * u, 140 * u, 90 * u, '#f8c8dc');
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 70 * u, gy - 90 * u, 140 * u, 18 * u);
      ctx.fillStyle = '#f1c40f'; ctx.fillRect(x - 4 * u, gy - 130 * u, 8 * u, 40 * u);
      ctx.fillStyle = '#e67e22'; ctx.beginPath(); ctx.ellipse(x, gy - 140 * u + Math.sin(t * 12) * 2 * u, 8 * u, 13 * u, 0, 0, Math.PI * 2); ctx.fill();
      break;
    case 'gift':
      box(x - 60 * u, gy - 110 * u, 120 * u, 110 * u, '#9b59b6');
      ctx.fillStyle = '#f1c40f'; ctx.fillRect(x - 10 * u, gy - 110 * u, 20 * u, 110 * u);
      break;
    case 'money':
      for (let i = 0; i < 3; i++) box(x - 70 * u + i * 8 * u, gy - 34 * u - i * 18 * u, 140 * u, 34 * u, '#27ae60');
      ctx.fillStyle = '#fff'; ctx.font = `bold ${26 * u}px sans-serif`; ctx.textAlign = 'center'; ctx.fillText('$', x + 16 * u, gy - 60 * u);
      break;
    case 'ball':
      ctx.fillStyle = '#e67e22'; ctx.beginPath(); ctx.arc(x, gy - 45 * u - Math.abs(Math.sin(t * 5)) * 80 * u, 45 * u, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      break;
    case 'sign':
      box(x - 8 * u, gy - 260 * u, 16 * u, 260 * u, '#8b5a2b');
      box(x - 110 * u, gy - 330 * u, 220 * u, 100 * u, '#fff');
      break;
    case 'tree':
      tree(ctx, x, gy, 380 * u);
      break;
    case 'bed':
      box(x - 210 * u, gy - 120 * u, 420 * u, 70 * u, '#4a90d9');
      box(x - 210 * u, gy - 50 * u, 420 * u, 50 * u, '#6b4f2a');
      box(x - 230 * u, gy - 230 * u, 30 * u, 230 * u, '#6b4f2a');
      break;
    case 'tv':
      box(x - 130 * u, gy - 330 * u, 260 * u, 160 * u, '#222');
      ctx.fillStyle = `hsl(${(t * 80) % 360},60%,60%)`; ctx.fillRect(x - 115 * u, gy - 318 * u, 230 * u, 136 * u);
      box(x - 140 * u, gy - 170 * u, 280 * u, 170 * u, '#6b4f2a');
      break;
    case 'plant':
      box(x - 40 * u, gy - 80 * u, 80 * u, 80 * u, '#d35400');
      ctx.fillStyle = '#27ae60';
      for (const a of [-0.6, 0, 0.6]) { ctx.beginPath(); ctx.ellipse(x + Math.sin(a) * 40 * u, gy - 130 * u, 18 * u, 55 * u, a, 0, Math.PI * 2); ctx.fill(); }
      break;
    default:
      break;
  }
  ctx.restore();
}

// ---------- effects ----------

export function drawEffect(ctx, kind, w, h, gy, anchors, t, u) {
  const a = anchors[0] || { head: [w / 2, gy - 400 * u], r: 40 * u, top: gy - 460 * u, x: w / 2 };
  const [hx, hy] = a.head;
  const r = a.r;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  switch (kind) {
    case 'smoke':
      for (let i = 0; i < 9; i++) {
        const p = ((t * 0.35 + i / 9) % 1);
        const sx = w * (0.15 + ((i * 37) % 70) / 100) + Math.sin(t + i) * 30 * u;
        const sy = gy - p * gy * 0.9;
        ctx.globalAlpha = 0.55 * (1 - p);
        ctx.fillStyle = '#7f8c8d';
        ctx.beginPath(); ctx.arc(sx, sy, (50 + p * 120) * u, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 0.18; ctx.fillStyle = '#555'; ctx.fillRect(0, 0, w, h);
      break;
    case 'fire':
      for (let i = 0; i < 7; i++) {
        const fx = w * 0.82 + (i - 3) * 22 * u;
        const fh = (110 + Math.sin(t * 12 + i * 2) * 35) * u;
        ctx.fillStyle = i % 2 ? '#e74c3c' : '#f39c12';
        ctx.beginPath(); ctx.moveTo(fx - 30 * u, gy - 250 * u); ctx.quadraticCurveTo(fx, gy - 250 * u - fh * 1.6, fx + 30 * u, gy - 250 * u); ctx.fill();
      }
      break;
    case 'sweat':
      ctx.fillStyle = '#4aa3df';
      for (const [dx, dy, ph] of [[1.15, -0.4, 0], [1.3, 0.1, 0.5]]) {
        const d = ((t * 1.2 + ph) % 1) * r * 0.6;
        ctx.beginPath(); ctx.ellipse(hx + dx * r, hy + dy * r + d, r * 0.12, r * 0.2, 0, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'exclamation':
    case 'question': {
      const s = 1 + Math.sin(t * 10) * 0.08;
      ctx.font = `900 ${r * 2.2 * s}px system-ui, sans-serif`; ctx.textAlign = 'center';
      ctx.fillStyle = kind === 'exclamation' ? '#e74c3c' : '#2e86de';
      ctx.strokeStyle = '#fff'; ctx.lineWidth = r * 0.25;
      const ch = kind === 'exclamation' ? '!' : '?';
      ctx.strokeText(ch, hx + r * 0.9, a.top - r * 0.2); ctx.fillText(ch, hx + r * 0.9, a.top - r * 0.2);
      if (kind === 'exclamation') { ctx.strokeText(ch, hx + r * 1.7, a.top + r * 0.2); ctx.fillText(ch, hx + r * 1.7, a.top + r * 0.2); }
      break;
    }
    case 'hearts':
      ctx.fillStyle = '#e84393';
      for (let i = 0; i < 4; i++) {
        const p = (t * 0.6 + i / 4) % 1;
        const x = hx + (i - 1.5) * r * 0.9, y = hy - r - p * r * 3, s = r * 0.35;
        ctx.globalAlpha = 1 - p;
        ctx.beginPath(); ctx.moveTo(x, y + s * 0.8);
        ctx.bezierCurveTo(x - s * 1.5, y - s * 0.4, x - s * 0.4, y - s * 1.3, x, y - s * 0.3);
        ctx.bezierCurveTo(x + s * 0.4, y - s * 1.3, x + s * 1.5, y - s * 0.4, x, y + s * 0.8); ctx.fill();
      }
      break;
    case 'zzz':
      ctx.fillStyle = '#34495e';
      for (let i = 0; i < 3; i++) {
        const p = (t * 0.5 + i / 3) % 1;
        ctx.globalAlpha = 1 - p;
        ctx.font = `900 ${r * (0.6 + i * 0.25)}px system-ui, sans-serif`;
        ctx.fillText('Z', hx + r * (1 + p * 1.5), hy - r * (1 + p * 2.5));
      }
      break;
    case 'motion_lines':
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6 * u;
      for (const an of anchors) {
        for (let i = 0; i < 4; i++) {
          const ly = an.head[1] + an.r * (1.5 + i * 2.2);
          const off = ((t * 8 + i) % 1) * 30 * u;
          ctx.beginPath(); ctx.moveTo(an.x - 120 * u - off, ly); ctx.lineTo(an.x - 220 * u - off, ly); ctx.stroke();
        }
      }
      break;
    case 'stars':
      ctx.fillStyle = '#f1c40f';
      for (let i = 0; i < 4; i++) {
        const ang = t * 4 + (i * Math.PI) / 2;
        const sx = hx + Math.cos(ang) * r * 1.4, sy = hy - r * 1.2 + Math.sin(ang) * r * 0.4;
        ctx.beginPath();
        for (let k = 0; k < 10; k++) {
          const rr = k % 2 ? r * 0.12 : r * 0.3;
          const aa = (k / 10) * Math.PI * 2 - Math.PI / 2;
          ctx.lineTo(sx + Math.cos(aa) * rr, sy + Math.sin(aa) * rr);
        }
        ctx.fill();
      }
      break;
    case 'rain':
      ctx.strokeStyle = 'rgba(52,152,219,0.7)'; ctx.lineWidth = 4 * u;
      for (let i = 0; i < 70; i++) {
        const rx = ((i * 7919) % 1000) / 1000 * w;
        const ry = (((i * 3571) % 1000) / 1000 * h + t * 1400 * u) % h;
        ctx.beginPath(); ctx.moveTo(rx, ry); ctx.lineTo(rx - 10 * u, ry + 40 * u); ctx.stroke();
      }
      break;
    case 'sparkles':
      ctx.strokeStyle = '#f1c40f'; ctx.lineWidth = 5 * u;
      for (let i = 0; i < 8; i++) {
        const sx = ((i * 7919) % 1000) / 1000 * w, sy = ((i * 104729) % 1000) / 1000 * gy;
        const s = (0.5 + 0.5 * Math.sin(t * 5 + i)) * 25 * u;
        ctx.beginPath(); ctx.moveTo(sx - s, sy); ctx.lineTo(sx + s, sy); ctx.moveTo(sx, sy - s); ctx.lineTo(sx, sy + s); ctx.stroke();
      }
      break;
    case 'anger': {
      ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = r * 0.14;
      const ax = hx + r * 0.95, ay = hy - r * 0.95, s = r * (0.35 + Math.sin(t * 12) * 0.05);
      for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
        ctx.beginPath(); ctx.moveTo(ax + sx * s * 0.25, ay + sy * s); ctx.quadraticCurveTo(ax + sx * s * 0.25, ay + sy * s * 0.25, ax + sx * s, ay + sy * s * 0.25); ctx.stroke();
      }
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

function wrapText(ctx, text, maxW) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = '';
  for (const wd of words) {
    const test = line ? line + ' ' + wd : wd;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = wd; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

export function drawSpeech(ctx, text, anchor, w, u) {
  if (!text) return;
  ctx.save();
  const fs = Math.max(18, 42 * u);
  ctx.font = `700 ${fs}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const lines = wrapText(ctx, text, Math.min(w * 0.42, 520 * u));
  const lh = fs * 1.2;
  const bw = Math.max(...lines.map((l) => ctx.measureText(l).width)) + fs * 1.2;
  const bh = lines.length * lh + fs * 0.8;
  let bx = anchor.head[0] - bw / 2;
  bx = Math.max(10 * u, Math.min(w - bw - 10 * u, bx));
  const by = anchor.top - bh - 40 * u;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = INK; ctx.lineWidth = 5 * u;
  roundRect(ctx, bx, Math.max(10 * u, by), bw, bh, fs * 0.6); ctx.fill(); ctx.stroke();
  const tyBase = Math.max(10 * u, by);
  const tx = Math.min(Math.max(anchor.head[0], bx + 30 * u), bx + bw - 30 * u);
  ctx.beginPath(); ctx.moveTo(tx - 18 * u, tyBase + bh - 2 * u); ctx.lineTo(anchor.head[0], anchor.top - 6 * u); ctx.lineTo(tx + 18 * u, tyBase + bh - 2 * u);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.fillRect(tx - 16 * u, tyBase + bh - 8 * u, 32 * u, 8 * u);
  ctx.fillStyle = INK; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + bw / 2, tyBase + fs * 0.4 + i * lh));
  ctx.restore();
}

export function drawSoundEffect(ctx, text, w, h, t, u, side = 'right') {
  if (!text) return;
  ctx.save();
  const pop = Math.min(1, t / 0.18);
  const s = (0.4 + 0.6 * pop) * (1 + Math.sin(t * 8) * 0.03);
  const cx = side === 'left' ? w * 0.26 : w * 0.74, cy = h * 0.14;
  ctx.translate(cx, cy); ctx.rotate(-0.12); ctx.scale(s, s);
  const R = 150 * u;
  ctx.fillStyle = '#ffd60a'; ctx.strokeStyle = INK; ctx.lineWidth = 6 * u;
  ctx.beginPath();
  for (let k = 0; k < 24; k++) {
    const rr = k % 2 ? R * 0.72 : R;
    const aa = (k / 24) * Math.PI * 2;
    ctx.lineTo(Math.cos(aa) * rr * 1.35, Math.sin(aa) * rr * 0.85);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  const fs = Math.min(90 * u, (R * 2.2) / Math.max(3, text.length) * 1.6);
  ctx.font = `900 ${fs}px Impact, 'Arial Black', system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 8 * u; ctx.strokeStyle = INK; ctx.strokeText(text.toUpperCase(), 0, 0);
  ctx.fillStyle = '#e63946'; ctx.fillText(text.toUpperCase(), 0, 0);
  ctx.restore();
}

/**
 * Draw a full illustrated scene into a w×h area.
 * `t` = seconds since the shot started, `dur` = shot length (for camera moves).
 */
export function drawScene(ctx, w, h, scene, characters, t = 0, dur = 3, opts = {}) {
  const u = Math.min(w, h) / 1000;
  const portrait = h > w * 1.2;
  const gy = h * (portrait ? 0.72 : 0.86);
  const size = Math.min(h * (portrait ? 0.36 : 0.58), w * 0.62);
  ctx.save();
  // camera: gentle push-in plus a small pop at the cut
  const prog = Math.min(1, t / Math.max(0.5, dur));
  const pop = t < 0.2 ? 1.04 - (t / 0.2) * 0.04 : 1;
  const zoom = (1 + prog * 0.06) * pop;
  ctx.translate(w / 2, gy * 0.85);
  ctx.scale(zoom, zoom);
  ctx.translate(-w / 2, -gy * 0.85);

  drawSetting(ctx, w, h, scene.setting || 'blank', gy, t);
  for (const p of scene.props || []) drawProp(ctx, p.kind, p.x * w, gy, u * (portrait ? 0.9 : 1), t);

  const byId = Object.fromEntries(characters.map((c) => [c.id, c]));
  const anchors = [];
  (scene.actors || []).forEach((a, i) => {
    const ch = byId[a.character_id] || characters[0] || { id: 'x', color: '#e4572e', hair: 'short' };
    const anc = drawCharacter(ctx, ch, {
      x: a.x * w, groundY: gy, size, pose: a.pose, expression: a.expression, facing: a.facing, t, seed: i * 1.7,
    });
    anchors.push(anc);
  });
  for (const e of scene.effects || []) drawEffect(ctx, e, w, h, gy, anchors, t, u);
  (scene.actors || []).forEach((a, i) => { if (a.speech) drawSpeech(ctx, a.speech, anchors[i], w, u); });
  ctx.restore();
  drawSoundEffect(ctx, scene.sound_effect, w, h, t, u, opts.sfxSide);
}

/** Character turnaround card for the approval step. */
export function drawCharacterCard(ctx, w, h, ch, t = 0) {
  ctx.save();
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#ddd'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(w * 0.08, h * 0.88); ctx.lineTo(w * 0.92, h * 0.88); ctx.stroke();
  const size = h * 0.62;
  drawCharacter(ctx, ch, { x: w * 0.3, groundY: h * 0.88, size, pose: 'stand', expression: 'happy', facing: 'right', t });
  drawCharacter(ctx, ch, { x: w * 0.72, groundY: h * 0.88, size, pose: 'wave', expression: 'neutral', facing: 'left', t });
  ctx.restore();
}
