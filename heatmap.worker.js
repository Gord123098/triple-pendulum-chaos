
self.onmessage = function (e) {
    const { width, height, params, range } = e.data;

    // Unpack params for speed
    const m1 = params.m1, m2 = params.m2, m3 = params.m3;
    const l1 = params.l1, l2 = params.l2, l3 = params.l3;
    const g = params.g;
    const damping = params.damping;

    // Precompute constants
    const M1 = m1 + m2 + m3;
    const M2 = m2 + m3;
    const M3 = m3;

    const rangeT1 = range.maxT1 - range.minT1;
    const rangeT2 = range.maxT2 - range.minT2;
    const minT1 = range.minT1;
    const minT2 = range.minT2;

    // Output buffer
    const buffer = new Uint8ClampedArray(width * height * 4);

    const maxTime = 12; // Reduced from 15 for speed
    const dt = 0.05;
    const steps = Math.floor(maxTime / dt);

    // Reusable state variables to avoid allocation
    let t1, t2, t3, w1, w2, w3;
    let k1_0, k1_1, k1_2, k1_3, k1_4, k1_5;
    let k2_0, k2_1, k2_2, k2_3, k2_4, k2_5;
    let k3_0, k3_1, k3_2, k3_3, k3_4, k3_5;
    let k4_0, k4_1, k4_2, k4_3, k4_4, k4_5;

    // Helper to solve linear system for accel (inlined for performance)
    function computeDerivatives(st1, st2, st3, sw1, sw2, sw3, out) {
        // Matrix A
        // [ A00 A01 A02 ]
        // [ A10 A11 A12 ]
        // [ A20 A21 A22 ]

        const c12 = Math.cos(st1 - st2);
        const c13 = Math.cos(st1 - st3);
        const c23 = Math.cos(st2 - st3);

        const A00 = M1 * l1 * l1;
        const A01 = M2 * l1 * l2 * c12;
        const A02 = M3 * l1 * l3 * c13;
        const A11 = M2 * l2 * l2;
        const A12 = M3 * l2 * l3 * c23;
        const A22 = M3 * l3 * l3;

        // RHS b
        const s1 = Math.sin(st1);
        const s2 = Math.sin(st2);
        const s3 = Math.sin(st3);
        const s12 = Math.sin(st1 - st2);
        const s13 = Math.sin(st1 - st3);
        const s23 = Math.sin(st2 - st3);

        const b0 = -M2 * l1 * l2 * sw2 * sw2 * s12
            - M3 * l1 * l3 * sw3 * sw3 * s13
            - M1 * g * l1 * s1
            - damping * sw1;

        const b1 = M2 * l1 * l2 * sw1 * sw1 * s12
            - M3 * l2 * l3 * sw3 * sw3 * s23
            - M2 * g * l2 * s2
            - damping * sw2;

        const b2 = M3 * l1 * l3 * sw1 * sw1 * s13
            + M3 * l2 * l3 * sw2 * sw2 * s23
            - M3 * g * l3 * s3
            - damping * sw3;

        // Solve Ax = b using Cramer's rule (inlined 3x3 solver)
        const det = A00 * (A11 * A22 - A12 * A12) -
            A01 * (A01 * A22 - A12 * A02) +
            A02 * (A01 * A12 - A11 * A02);

        // Fallback for singularity (rare in pendulums but possible)
        if (Math.abs(det) < 1e-9) {
            out[0] = sw1; out[1] = sw2; out[2] = sw3;
            out[3] = 0; out[4] = 0; out[5] = 0;
            return;
        }

        const invDet = 1 / det;

        const x0 = (b0 * (A11 * A22 - A12 * A12) - A01 * (b1 * A22 - A12 * b2) + A02 * (b1 * A12 - A11 * b2)) * invDet;
        const x1 = (A00 * (b1 * A22 - A12 * b2) - b0 * (A01 * A22 - A12 * A02) + A02 * (A01 * b2 - b1 * A02)) * invDet;
        const x2 = (A00 * (A11 * b2 - b1 * A12) - A01 * (A01 * b2 - b1 * A02) + b0 * (A01 * A12 - A11 * A02)) * invDet;

        out[0] = sw1; out[1] = sw2; out[2] = sw3;
        out[3] = x0; out[4] = x1; out[5] = x2;
    }

    const d_out = new Float64Array(6);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {

            // Initial Conditions
            t1 = (x / width) * rangeT1 + minT1;
            t2 = (y / height) * rangeT2 + minT2;
            t3 = 0;
            w1 = 0; w2 = 0; w3 = 0;

            let flipTime = maxTime;
            let flipped = false;

            for (let i = 0; i < steps; i++) {
                // RK4 Step 1
                computeDerivatives(t1, t2, t3, w1, w2, w3, d_out);
                k1_0 = d_out[0]; k1_1 = d_out[1]; k1_2 = d_out[2];
                k1_3 = d_out[3]; k1_4 = d_out[4]; k1_5 = d_out[5];

                // RK4 Step 2
                computeDerivatives(
                    t1 + k1_0 * dt * 0.5, t2 + k1_1 * dt * 0.5, t3 + k1_2 * dt * 0.5,
                    w1 + k1_3 * dt * 0.5, w2 + k1_4 * dt * 0.5, w3 + k1_5 * dt * 0.5,
                    d_out
                );
                k2_0 = d_out[0]; k2_1 = d_out[1]; k2_2 = d_out[2];
                k2_3 = d_out[3]; k2_4 = d_out[4]; k2_5 = d_out[5];

                // RK4 Step 3
                computeDerivatives(
                    t1 + k2_0 * dt * 0.5, t2 + k2_1 * dt * 0.5, t3 + k2_2 * dt * 0.5,
                    w1 + k2_3 * dt * 0.5, w2 + k2_4 * dt * 0.5, w3 + k2_5 * dt * 0.5,
                    d_out
                );
                k3_0 = d_out[0]; k3_1 = d_out[1]; k3_2 = d_out[2];
                k3_3 = d_out[3]; k3_4 = d_out[4]; k3_5 = d_out[5];

                // RK4 Step 4
                computeDerivatives(
                    t1 + k3_0 * dt, t2 + k3_1 * dt, t3 + k3_2 * dt,
                    w1 + k3_3 * dt, w2 + k3_4 * dt, w3 + k3_5 * dt,
                    d_out
                );
                k4_0 = d_out[0]; k4_1 = d_out[1]; k4_2 = d_out[2];
                k4_3 = d_out[3]; k4_4 = d_out[4]; k4_5 = d_out[5];

                // Update State
                t1 += (dt / 6) * (k1_0 + 2 * k2_0 + 2 * k3_0 + k4_0);
                t2 += (dt / 6) * (k1_1 + 2 * k2_1 + 2 * k3_1 + k4_1);
                t3 += (dt / 6) * (k1_2 + 2 * k2_2 + 2 * k3_2 + k4_2);
                w1 += (dt / 6) * (k1_3 + 2 * k2_3 + 2 * k3_3 + k4_3);
                w2 += (dt / 6) * (k1_4 + 2 * k2_4 + 2 * k3_4 + k4_4);
                w3 += (dt / 6) * (k1_5 + 2 * k2_5 + 2 * k3_5 + k4_5);

                // Check flip (simple heuristic: has t3 crossed horizontal pi or -pi?)
                // Use absolute angle > PI check for simplicity
                if (Math.abs(t3) > Math.PI) {
                    flipTime = i * dt;
                    flipped = true;
                    break;
                }
            }

            const idx = (y * width + x) * 4;
            if (!flipped) {
                buffer[idx] = 15; buffer[idx + 1] = 23; buffer[idx + 2] = 42; buffer[idx + 3] = 255;
            } else {
                const tNorm = flipTime / maxTime;
                const r = Math.floor(255 * (1 - tNorm));
                const g = Math.floor(100 * (1 - tNorm));
                const b = Math.floor(255 * tNorm);
                buffer[idx] = r; buffer[idx + 1] = g; buffer[idx + 2] = b; buffer[idx + 3] = 255;
            }
        }
    }

    self.postMessage({ buffer, width, height }, [buffer.buffer]);
};
