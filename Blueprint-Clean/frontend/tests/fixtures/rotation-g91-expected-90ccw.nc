; M.A.B. S1 rotation test - EXPECTED RESULT after 90 deg CCW rotation of PART A only
; TEST ONLY - not a production cut file.
; Rule used for every Part A vector (X/Y and arc I/J alike):
;   (dx, dy) -> (-dy, dx)
; G02 stays G02: a proper rotation does not flip arc direction (a mirror would).
; Part B is unchanged, line for line.
;
G70
G91
; --- PART A rotated 90 deg CCW ---
G01 X0.000 Y2.000
G01 X-1.000 Y0.000
G01 X0.000 Y-2.000
G01 X1.000 Y0.000
G02 X0.000 Y2.000 I0.000 J1.000
; --- PART B (control, unchanged) ---
G01 X1.000 Y0.000
G01 X0.000 Y1.000
G01 X-1.000 Y0.000
G01 X0.000 Y-1.000
