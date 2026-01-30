
export class TriplePendulumPhysics {
    constructor(m1, m2, m3, l1, l2, l3, g, damping) {
        this.m1 = m1; this.m2 = m2; this.m3 = m3;
        this.l1 = l1; this.l2 = l2; this.l3 = l3;
        this.g = g;
        this.damping = damping;
    }

    // Solve Ax = b for x
    solve3x3(A, b) {
        // Cramer's rule or direct inversion is fine for 3x3
        // A is symmetric, but general inverse is safer
        const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
            A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
            A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);

        if (Math.abs(det) < 1e-9) return [0, 0, 0]; // Singularity check

        const invDet = 1 / det;

        const x = [];

        // x1
        const det1 = b[0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
            A[0][1] * (b[1] * A[2][2] - A[1][2] * b[2]) +
            A[0][2] * (b[1] * A[2][1] - A[1][1] * b[2]);
        x[0] = det1 * invDet;

        // x2
        const det2 = A[0][0] * (b[1] * A[2][2] - A[1][2] * b[2]) -
            b[0] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
            A[0][2] * (A[1][0] * b[2] - b[1] * A[2][0]);
        x[1] = det2 * invDet;

        // x3
        const det3 = A[0][0] * (A[1][1] * b[2] - b[1] * A[2][1]) -
            A[0][1] * (A[1][0] * b[2] - b[1] * A[2][0]) +
            b[0] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
        x[2] = det3 * invDet;

        return x;
    }

    getDerivatives(state) {
        const [t1, t2, t3, w1, w2, w3] = state;
        const { m1, m2, m3, l1, l2, l3, g, damping } = this;

        // Mass sums
        const M1 = m1 + m2 + m3;
        const M2 = m2 + m3;
        const M3 = m3;

        // Matrix A
        const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
        A[0][0] = M1 * l1 * l1;
        A[0][1] = M2 * l1 * l2 * Math.cos(t1 - t2);
        A[0][2] = M3 * l1 * l3 * Math.cos(t1 - t3);

        A[1][0] = A[0][1];
        A[1][1] = M2 * l2 * l2;
        A[1][2] = M3 * l2 * l3 * Math.cos(t2 - t3);

        A[2][0] = A[0][2];
        A[2][1] = A[1][2];
        A[2][2] = M3 * l3 * l3;

        // Vector b (RHS)
        // Terms from lagrangian derivation:
        // For eq 1: -M2 l1 l2 w2^2 sin(t1-t2) - M3 l1 l3 w3^2 sin(t1-t3) - M1 g l1 sin(t1)
        // For eq 2: +M2 l1 l2 w1^2 sin(t1-t2) - M3 l2 l3 w3^2 sin(t2-t3) - M2 g l2 sin(t2)
        // For eq 3: +M3 l1 l3 w1^2 sin(t1-t3) + M3 l2 l3 w2^2 sin(t2-t3) - M3 g l3 sin(t3)

        // Add damping: -k * w_i

        const b = [0, 0, 0];
        b[0] = -M2 * l1 * l2 * w2 * w2 * Math.sin(t1 - t2)
            - M3 * l1 * l3 * w3 * w3 * Math.sin(t1 - t3)
            - M1 * g * l1 * Math.sin(t1)
            - damping * w1;

        b[1] = M2 * l1 * l2 * w1 * w1 * Math.sin(t1 - t2)
            - M3 * l2 * l3 * w3 * w3 * Math.sin(t2 - t3)
            - M2 * g * l2 * Math.sin(t2)
            - damping * w2;

        b[2] = M3 * l1 * l3 * w1 * w1 * Math.sin(t1 - t3)
            + M3 * l2 * l3 * w2 * w2 * Math.sin(t2 - t3)
            - M3 * g * l3 * Math.sin(t3)
            - damping * w3;

        const alphas = this.solve3x3(A, b);

        return [w1, w2, w3, alphas[0], alphas[1], alphas[2]];
    }
}
