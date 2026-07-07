/**
 * 🍰 Kawaii Bakery — VR Support (NEW)
 * vr.js
 *
 * Adds full WebXR support on top of the existing desktop game:
 *
 *  - thumbstick-locomotion : smooth movement with the LEFT joystick.
 *                            Moves the camera RIG (#player), head-relative,
 *                            stops instantly when the stick recenters.
 *  - snap-turn             : RIGHT joystick snap turning in 45° steps,
 *                            pivoting around the player's head position.
 *  - vr-grab               : GRIP button grabs the item the controller laser
 *                            is pointing at; releasing grip over a matching
 *                            zone places it, otherwise the item goes DYNAMIC
 *                            and is thrown with the controller's velocity.
 *  - vr-mode-manager       : on enter-vr, disables the desktop gaze cursor
 *                            and desktop click handling; restores them on
 *                            exit-vr. Trigger clicks in VR reuse the exact
 *                            same 'click' events the desktop cursor emits,
 *                            so all existing gameplay logic is unchanged.
 *
 * No teleportation. Desktop WASD + mouse-look are untouched.
 */

/* ─────────────────────────────────────────────
 * SMOOTH LOCOMOTION (left thumbstick)
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('thumbstick-locomotion', {
  schema: {
    speed:    { type: 'number', default: 2.2 },  // metres / second
    deadzone: { type: 'number', default: 0.15 },
  },

  init: function () {
    this.axisX = 0;
    this.axisY = 0;
    this.rig  = document.querySelector('#player');
    this.head = document.querySelector('#head');

    this.onThumbstick = (evt) => {
      const x = evt.detail.x || 0;
      const y = evt.detail.y || 0;
      // Movement stops immediately when the stick returns to centre.
      this.axisX = Math.abs(x) < this.data.deadzone ? 0 : x;
      this.axisY = Math.abs(y) < this.data.deadzone ? 0 : y;
    };
    this.el.addEventListener('thumbstickmoved', this.onThumbstick);

    // Reused vectors (avoid per-frame allocation)
    this._fwd   = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._move  = new THREE.Vector3();
  },

  tick: function (time, delta) {
    if (!this.axisX && !this.axisY) return;
    if (!this.rig || !this.head) return;
    const scene = this.el.sceneEl;
    if (!scene.is('vr-mode')) return; // VR-only; desktop uses WASD

    const dt = Math.min(delta, 50) / 1000;

    // Head-relative movement, flattened to the ground plane.
    this.head.object3D.getWorldDirection(this._fwd);
    this._fwd.y = 0;
    // getWorldDirection points along -Z (behind), so negate for "forward".
    this._fwd.multiplyScalar(-1).normalize();
    this._right.crossVectors(this._fwd, new THREE.Vector3(0, 1, 0)).normalize();

    this._move.set(0, 0, 0)
      .addScaledVector(this._fwd,  -this.axisY)   // stick up (y = -1) => forward
      .addScaledVector(this._right, this.axisX);

    if (this._move.lengthSq() > 1) this._move.normalize();
    this._move.multiplyScalar(this.data.speed * dt);

    this.rig.object3D.position.add(this._move);
  },

  remove: function () {
    this.el.removeEventListener('thumbstickmoved', this.onThumbstick);
  },
});

/* ─────────────────────────────────────────────
 * SNAP TURN (right thumbstick, 45° increments)
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('snap-turn', {
  schema: {
    degrees:   { type: 'number', default: 45 },
    threshold: { type: 'number', default: 0.75 }, // stick must pass this to turn
    resetAt:   { type: 'number', default: 0.35 }, // and return below this to re-arm
  },

  init: function () {
    this.armed = true;
    this.rig  = document.querySelector('#player');
    this.head = document.querySelector('#head');

    this.onThumbstick = (evt) => {
      const x = evt.detail.x || 0;

      if (Math.abs(x) < this.data.resetAt) { this.armed = true; return; }
      if (!this.armed || Math.abs(x) < this.data.threshold) return;
      this.armed = false;

      const dir = x > 0 ? -1 : 1; // stick right = turn clockwise
      this.turn(dir * this.data.degrees);
    };
    this.el.addEventListener('thumbstickmoved', this.onThumbstick);
  },

  // Rotate the rig around the HEAD's world position so the player pivots in
  // place instead of orbiting the rig origin.
  turn: function (degrees) {
    if (!this.rig || !this.head) return;
    const rad = THREE.MathUtils.degToRad(degrees);

    const headWorld = new THREE.Vector3();
    this.head.object3D.getWorldPosition(headWorld);

    const rigObj = this.rig.object3D;
    rigObj.rotation.y += rad;

    // Compensate translation so the head stays where it was.
    const newHeadWorld = new THREE.Vector3();
    rigObj.updateMatrixWorld(true);
    this.head.object3D.getWorldPosition(newHeadWorld);
    rigObj.position.add(headWorld.sub(newHeadWorld));
  },

  remove: function () {
    this.el.removeEventListener('thumbstickmoved', this.onThumbstick);
  },
});

/* ─────────────────────────────────────────────
 * GRIP GRAB + THROW
 *  - gripdown: grab the interactable under this controller's laser
 *  - gripup:   over a drop-zone  -> try to place it
 *              otherwise         -> release as a DYNAMIC physics body,
 *                                   thrown with the recent hand velocity
 * (Trigger pick-up/placement is handled automatically: laser-controls fires
 *  'click' on intersected entities, which the existing pickupable and
 *  drop-zone components already listen for.)
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('vr-grab', {
  init: function () {
    this.grabbing = false;

    this.onGripDown = () => {
      // 1) Laser hit wins…
      let target = this.raycastTarget('[item-type]');
      // 2) …otherwise grab the nearest item within arm's reach of the hand.
      if (!target) target = this.nearestItem(0.45);
      if (target && window.bakeryGame) {
        window.bakeryGame.pickUpItem(target, this.el); // follow THIS controller
        this.grabbing = !!window.bakeryGame.heldItem;
      }
    };

    this.onGripUp = () => {
      if (!this.grabbing) return;
      this.grabbing = false;
      const game = window.bakeryGame;
      if (!game || !game.heldItem) return;

      // If pointing at (or standing at) a drop-zone, attempt placement first.
      const zone = this.raycastTarget('[zone-type]');
      if (zone) {
        game.tryPlace(zone);
        if (!game.heldItem) return; // placed successfully
      }
      // Otherwise: throw it. game.js computes velocity from recent frames.
      game.releaseHeldWithPhysics();
    };

    this.el.addEventListener('gripdown', this.onGripDown);
    this.el.addEventListener('gripup', this.onGripUp);
  },

  // Resolve this controller's current raycaster intersections to the nearest
  // ancestor matching the given selector (e.g. '[item-type]', '[zone-type]').
  raycastTarget: function (selector) {
    const rc = this.el.components.raycaster;
    if (!rc) return null;
    const els = rc.intersectedEls || [];
    for (const hit of els) {
      if (!hit || !hit.closest) continue;
      const root = hit.closest(selector);
      if (root) return root;
    }
    return null;
  },

  // Proximity grab: nearest un-placed interactable within `radius` metres of
  // the controller — lets players physically reach out and squeeze grip
  // without needing perfect laser aim.
  nearestItem: function (radius) {
    const handPos = new THREE.Vector3();
    this.el.object3D.getWorldPosition(handPos);
    const itemPos = new THREE.Vector3();
    let best = null;
    let bestDist = radius;
    document.querySelectorAll('[item-type]').forEach((item) => {
      const pk = item.components && item.components.pickupable;
      if (pk && pk.isPlaced) return;
      if (!item.object3D) return;
      item.object3D.getWorldPosition(itemPos);
      const d = handPos.distanceTo(itemPos);
      if (d < bestDist) { bestDist = d; best = item; }
    });
    return best;
  },

  remove: function () {
    this.el.removeEventListener('gripdown', this.onGripDown);
    this.el.removeEventListener('gripup', this.onGripUp);
  },
});

/* ─────────────────────────────────────────────
 * DESKTOP <-> VR MODE MANAGER (on <a-scene>)
 * ───────────────────────────────────────────── */
AFRAME.registerComponent('vr-mode-manager', {
  init: function () {
    const scene = this.el;

    scene.addEventListener('enter-vr', () => {
      // Hide the gaze cursor + stop its raycaster; controllers take over.
      const cursor = document.querySelector('#cursor');
      if (cursor) {
        cursor.setAttribute('visible', 'false');
        cursor.setAttribute('raycaster', 'enabled', false);
      }
      document.body.classList.add('in-vr');
      console.log('[vr.js] Entered VR — controllers active, desktop cursor disabled');
    });

    scene.addEventListener('exit-vr', () => {
      const cursor = document.querySelector('#cursor');
      if (cursor) {
        cursor.setAttribute('visible', 'true');
        cursor.setAttribute('raycaster', 'enabled', true);
      }
      document.body.classList.remove('in-vr');
      console.log('[vr.js] Exited VR — desktop mode restored');
    });
  },
});
