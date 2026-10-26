; M.A.B. S1 rotation test - ORIGINAL
; TEST ONLY - not a production cut file. Check vectors, not the picture.
; Dialect: G70 inch, G91 incremental (each X/Y move is a vector from the
; last point, matching the Bat Axe 2 file seen in Kreepy's screenshots).
; Part A is the part to rotate. Part B is an unchanged control part:
; in the rotated file, Part B's lines must be byte-identical.
;
G70
G91
; --- PART A: rectangle 2.0 wide x 1.0 tall, then a semicircle radius 1.0 ---
G01 X2.000 Y0.000
G01 X0.000 Y1.000
G01 X-2.000 Y0.000
G01 X0.000 Y-1.000
G02 X2.000 Y0.000 I1.000 J0.000
; --- PART B (control, do NOT rotate): 1.0 x 1.0 square ---
G01 X1.000 Y0.000
G01 X0.000 Y1.000
G01 X-1.000 Y0.000
G01 X0.000 Y-1.000
