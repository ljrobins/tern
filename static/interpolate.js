class QuadraticFit {
    constructor() {
        this.is_fit = false; // Whether the fit exists
        this.coefficientsX = null; // Coefficients for x (a_x, b_x, c_x)
        this.coefficientsY = null; // Coefficients for y (a_y, b_y, c_y)
        this.points = []; // Store points as {t, x, y}
    }

    addPoint(t, x, y) {
        this.points.push({ t, x, y });

        // Keep only the most recent three points
        if (this.points.length > 3) {
            this.points.shift();
        }

        // Fit a quadratic if we have exactly three points
        if (this.points.length === 3) {
            const [p1, p2, p3] = this.points;
            this.fit(p1.t, p1.x, p1.y, p2.t, p2.x, p2.y, p3.t, p3.x, p3.y);
        }
    }

    fit(t1, x1, y1, t2, x2, y2, t3, x3, y3) {
        const t = [t1, t2, t3];
        const Tx = [x1, x2, x3];
        const Ty = [y1, y2, y3];

        this.coefficientsX = this._computeQuadratic(t, Tx);
        this.coefficientsY = this._computeQuadratic(t, Ty);
        this.is_fit = true; // now the fit exists
    }

    _computeQuadratic(t, values) {
        const [t1, t2, t3] = t;

        const matrix = [
            [t1 * t1, t1, 1],
            [t2 * t2, t2, 1],
            [t3 * t3, t3, 1],
        ];

        const determinant = (m) =>
            m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
            m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
            m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

        const detMatrix = determinant(matrix);

        const solve = (col) => {
            const replacedMatrix = matrix.map((row, i) =>
                row.map((val, j) => (j === col ? values[i] : val))
            );
            return determinant(replacedMatrix) / detMatrix;
        };

        const a = solve(0);
        const b = solve(1);
        const c = solve(2);

        return [a, b, c];
    }

    evaluate(t) {
        if (!this.coefficientsX || !this.coefficientsY) {
            throw new Error("Quadratic coefficients are not yet set.");
        }

        const [ax, bx, cx] = this.coefficientsX;
        const [ay, by, cy] = this.coefficientsY;

        const x = ax * t * t + bx * t + cx;
        const y = ay * t * t + by * t + cy;

        return { x, y };
    }
}
