import numpy as np

# ===== パラメータ（フレスコボール想定） =====
d = 0.057      # ボール直径 m（2.25in≈5.7cm）
m = 0.040      # 質量 kg（40g, 中空ゴム）
rho = 1.2      # 空気密度
Cd = 0.5       # 球の抗力係数（Re~5e4域）
A = np.pi*(d/2)**2
L = 7.0        # 飛行距離
g = 9.81

nu = 1.5e-5
print(f"断面積 A = {A*1e4:.2f} cm^2, 弾道係数 m/(CdA) = {m/(Cd*A):.1f} kg/m^2")

def simulate(v0_kmh):
    """水平打ち出し近似で7m飛行をシミュレート（抗力のみ、2D簡略：速度方向抗力）"""
    v0 = v0_kmh/3.6
    Re = v0*d/nu
    dt = 1e-4
    x, v, t = 0.0, v0, 0.0
    while x < L:
        a = -0.5*rho*Cd*A*v*v/m
        v += a*dt
        x += v*dt
        t += dt
    v_avg = L/t
    return v0, v, t, v_avg, Re

print("\n初速[km/h] | 到達速[km/h] | 飛行時間[s] | 平均速[km/h] | 初速-平均差[km/h] | Re")
for vk in [40, 50, 55, 60, 70, 80, 90, 100]:
    v0, vf, t, va, Re = simulate(vk)
    print(f"{vk:8.0f} | {vf*3.6:10.1f} | {t:9.3f} | {va*3.6:10.1f} | {vk-va*3.6:8.1f} | {Re:.1e}")

# ===== 動画フレーム解析の誤差見積 =====
print("\n===== 240fps フレーム解析誤差 =====")
fps = 240
for vk in [50, 90]:
    v = vk/3.6
    # 7m全区間を使う場合
    t_full = simulate(vk)[2]
    n_frames = t_full*fps
    err_full = 2/n_frames  # 始点終点±1フレームずつ
    # 打点直後 1.5m 区間で初速を測る場合（減速の影響を抑える）
    seg = 1.5
    t_seg = seg/v  # 近似
    n_seg = t_seg*fps
    err_seg = 2/n_seg
    print(f"v={vk}km/h: 7m全区間 {n_frames:.0f}フレーム → 量子化誤差 ±{err_full*100/2:.2f}%（±1F両端で{err_full*100:.2f}%）")
    print(f"          1.5m区間 {n_seg:.0f}フレーム → 量子化誤差 ±{err_seg*100/2:.2f}% = ±{vk*err_seg/2:.2f} km/h")

# ===== 音声方式の誤差 =====
print("\n===== 打音時間差方式 =====")
c = 343.0
for vk in [50, 90]:
    v0, vf, t, va, Re = simulate(vk)
    # マイクが自分側にある場合：自打音は即到達、相手打音は7m伝搬遅延
    delay = L/c
    measured = t + delay   # 補正しない場合の見かけ飛行時間
    v_naive = L/measured*3.6
    print(f"初速{vk}km/h: 真の飛行時間{t:.3f}s, 音伝搬遅延{delay*1000:.1f}ms")
    print(f"  補正なし平均速 {v_naive:.1f} km/h（真の平均速 {va*3.6:.1f}）→ 伝搬補正は必須だが既知量")
    # 距離誤差の影響
    for dL in [0.25, 0.5]:
        print(f"  距離誤差±{dL}m → 速度誤差 ±{va*3.6*dL/L:.1f} km/h")

# ===== 軌道の弧長効果（山なり） =====
print("\n===== 軌道弧長の効果（直線7m vs 放物線） =====")
# 仰角theta で打った場合の弧長/直線距離比（簡易：重力のみ）
for vk in [50]:
    for theta_deg in [5, 10, 15]:
        th = np.radians(theta_deg)
        v = vk/3.6
        # 7m先で同じ高さに戻る放物線の弧長を数値計算
        dt = 1e-4
        x, y, vx, vy = 0,0, v*np.cos(th), v*np.sin(th)
        s = 0
        while x < L:
            ax = -0.5*rho*Cd*A*np.hypot(vx,vy)*vx/m
            ay = -g -0.5*rho*Cd*A*np.hypot(vx,vy)*vy/m
            vx += ax*dt; vy += ay*dt
            dx, dy = vx*dt, vy*dt
            x += dx; y += dy; s += np.hypot(dx,dy)
        print(f"仰角{theta_deg}°: 弧長 {s:.3f}m / 直線7m → +{(s/L-1)*100:.2f}%, 7m到達時高さ {y:+.2f}m")
