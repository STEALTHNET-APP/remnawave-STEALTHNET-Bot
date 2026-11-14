// STEALTHNET admin console — read-only SSH TUI дашборд панели.
// user/password/port берутся с бэкенда (внутренний секрет-гейт), метрики — оттуда же.
// Никакого шелла: сессия = bubbletea-программа.
package main

import (
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/ssh"
	"github.com/charmbracelet/wish"
	bm "github.com/charmbracelet/wish/bubbletea"
	lm "github.com/charmbracelet/wish/logging"
	"github.com/muesli/termenv"
	_ "time/tzdata"
)

func env(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

var (
	apiURL      = env("API_URL", "http://127.0.0.1:5000")
	internalKey = os.Getenv("INTERNAL_KEY")
	hostKeyPath = env("CONSOLE_HOSTKEY", "/data/host_ed25519")
	httpc       = &http.Client{Timeout: 8 * time.Second}
)

// ── данные с бэкенда ──
type creds struct {
	User     string `json:"user"`
	Password string `json:"password"`
	Port     int    `json:"port"`
}
type check struct {
	Name       string         `json:"name"`
	Status     string         `json:"status"`
	Detail     string         `json:"detail"`
	DurationMs int            `json:"durationMs"`
	// meta смешанного типа: числа (percent/totalKb…) И строки (url/username) →
	// map[string]any, числовые значения достаём через metaGet (json → float64).
	Meta map[string]any `json:"meta"`
}
type health struct {
	Status string  `json:"overallStatus"`
	Checks []check `json:"checks"`
}
type clientsT struct {
	Total    int `json:"total"`
	Blocked  int `json:"blocked"`
	NewToday int `json:"newToday"`
	NewWeek  int `json:"newWeek"`
}
type subsT struct {
	Active       int `json:"active"`
	AutoRenew    int `json:"autoRenew"`
	ExpiringSoon int `json:"expiringSoon"`
}
type revenueT struct {
	Today      float64 `json:"today"`
	TodayCount int     `json:"todayCount"`
	Month      float64 `json:"month"`
	MonthCount int     `json:"monthCount"`
	Currency   string  `json:"currency"`
}
type serverT struct {
	Hostname  string  `json:"hostname"`
	UptimeSec int64   `json:"uptimeSec"`
	LoadAvg   float64 `json:"loadAvg"`
	CPUCount  int     `json:"cpuCount"`
}
type metrics struct {
	ServiceName   string   `json:"serviceName"`
	Health        *health  `json:"health"`
	Clients       clientsT `json:"clients"`
	Subscriptions subsT    `json:"subscriptions"`
	Revenue       revenueT `json:"revenue"`
	Server        serverT  `json:"server"`
	Ts            int64    `json:"ts"`
}

func apiGET(path string, out any) error {
	req, _ := http.NewRequest(http.MethodGet, apiURL+path, nil)
	req.Header.Set("X-Internal-Key", internalKey)
	res, err := httpc.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusOK {
		return fmt.Errorf("HTTP %d", res.StatusCode)
	}
	return json.Unmarshal(b, out)
}

func fetchCreds() (creds, error)     { var c creds; return c, apiGET("/api/internal/console/creds", &c) }
func fetchMetrics() (metrics, error) { var m metrics; return m, apiGET("/api/internal/console/metrics", &m) }

// Кэш кред для auth: перечитываем с бэкенда раз в 20с, чтобы смена логина/пароля
// в админке (регенерация) подхватывалась живьём, без пересоздания контейнера.
// Порт при регенерации не меняется → пере-биндить сокет не нужно.
var (
	credMu    sync.Mutex
	credCache creds
	credAt    time.Time
)

func currentCreds() creds {
	credMu.Lock()
	defer credMu.Unlock()
	if time.Since(credAt) > 20*time.Second {
		if cc, err := fetchCreds(); err == nil && cc.User != "" {
			credCache = cc
			credAt = time.Now()
		}
	}
	return credCache
}

func main() {
	if internalKey == "" {
		log.Fatal("INTERNAL_KEY не задан")
	}
	// Ждём креды с бэкенда (api мог ещё не подняться).
	var c creds
	for i := 0; i < 100; i++ {
		cc, err := fetchCreds()
		if err == nil && cc.User != "" && cc.Port > 0 {
			c = cc
			break
		}
		log.Printf("жду креды с бэкенда (попытка %d): %v", i+1, err)
		time.Sleep(3 * time.Second)
	}
	if c.User == "" || c.Port == 0 {
		log.Fatal("не удалось получить креды консоли с бэкенда")
	}
	credCache = c
	credAt = time.Now()
	addr := fmt.Sprintf("0.0.0.0:%d", c.Port)

	passwordAuth := func(ctx ssh.Context, password string) bool {
		cur := currentCreds()
		ok := ctx.User() == cur.User &&
			subtle.ConstantTimeCompare([]byte(password), []byte(cur.Password)) == 1
		if !ok {
			time.Sleep(1200 * time.Millisecond)
		}
		return ok
	}

	progHandler := func(sess ssh.Session) *tea.Program {
		lipgloss.SetColorProfile(termenv.TrueColor)
		// Чистим ИСТОРИЮ терминала клиента перед запуском.
		// Альт-экран сам по себе историю не трогает: в iTerm2/Terminal.app колесо
		// мыши прокручивает основной буфер, и пользователь видит всё, что было в
		// его терминале ДО подключения (приглашение, старые команды). Тут это
		// лишний шум поверх дашборда, поэтому: ESC[3J — стереть сохранённые строки,
		// ESC[2J — очистить экран, ESC[H — курсор в начало.
		_, _ = sess.Write([]byte("\x1b[H\x1b[2J\x1b[3J"))
		// WithMouseCellMotion включает отслеживание мыши: терминал начинает
		// отдавать события колеса САМОЙ программе, а не прокручивать свой буфер.
		// Именно это физически запрещает «уехать вверх» из дашборда — очистки
		// истории мало, она лишь убирает то, что было до подключения.
		return tea.NewProgram(newModel(),
			tea.WithInput(sess), tea.WithOutput(sess), tea.WithAltScreen(),
			tea.WithMouseCellMotion())
	}

	srv, err := wish.NewServer(
		wish.WithAddress(addr),
		wish.WithHostKeyPath(hostKeyPath),
		wish.WithPasswordAuth(passwordAuth),
		wish.WithMiddleware(
			bm.MiddlewareWithProgramHandler(progHandler, termenv.TrueColor),
			lm.Middleware(),
		),
	)
	if err != nil {
		log.Fatalf("server: %v", err)
	}
	log.Printf("STEALTHNET console listening on %s (user %s)", addr, c.User)
	if err := srv.ListenAndServe(); err != nil && err != ssh.ErrServerClosed {
		log.Fatal(err)
	}
}

// ── палитра/стили ──
var (
	cBrand = lipgloss.Color("205") // розовый бренд
	cInk   = lipgloss.Color("231") // белый
	cOk    = lipgloss.Color("42")  // зелёный
	cWarn  = lipgloss.Color("214") // янтарный
	cErr   = lipgloss.Color("203") // красный
	cMuted = lipgloss.Color("245")
	cDim   = lipgloss.Color("240")
	cGold  = lipgloss.Color("179") // деньги

	stTitle = lipgloss.NewStyle().Foreground(cBrand).Bold(true)
	stInk   = lipgloss.NewStyle().Foreground(cInk).Bold(true)
	stMuted = lipgloss.NewStyle().Foreground(cMuted)
	stDim   = lipgloss.NewStyle().Foreground(cDim)
)

var msk = func() *time.Location {
	if l, err := time.LoadLocation("Europe/Moscow"); err == nil {
		return l
	}
	return time.FixedZone("MSK", 3*3600)
}()

type model struct {
	m       metrics
	errMsg  string
	updated time.Time
	w, h    int
}

func newModel() model { return model{w: 80, h: 24} }

type tickMsg time.Time
type metricsMsg struct {
	m   metrics
	err error
}

func loadCmd() tea.Cmd { return func() tea.Msg { m, e := fetchMetrics(); return metricsMsg{m, e} } }
func tickCmd() tea.Cmd {
	return tea.Tick(5*time.Second, func(t time.Time) tea.Msg { return tickMsg(t) })
}

func (mo model) Init() tea.Cmd { return tea.Batch(loadCmd(), tickCmd()) }

func (mo model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.WindowSizeMsg:
		mo.w, mo.h = msg.Width, msg.Height
	case tea.KeyMsg:
		switch msg.String() {
		case "q", "ctrl+c", "esc":
			return mo, tea.Quit
		case "r":
			return mo, loadCmd()
		}
	case metricsMsg:
		if msg.err != nil {
			mo.errMsg = msg.err.Error()
		} else {
			mo.m = msg.m
			mo.errMsg = ""
			mo.updated = time.Now()
		}
	case tickMsg:
		return mo, tea.Batch(loadCmd(), tickCmd())
	}
	return mo, nil
}

// ── helpers ──
func statusStyle(s string) lipgloss.Style {
	switch s {
	case "ok":
		return lipgloss.NewStyle().Foreground(cOk).Bold(true)
	case "warn":
		return lipgloss.NewStyle().Foreground(cWarn).Bold(true)
	case "error":
		return lipgloss.NewStyle().Foreground(cErr).Bold(true)
	default:
		return lipgloss.NewStyle().Foreground(cDim)
	}
}
func statusIcon(s string) string {
	switch s {
	case "ok":
		return "●"
	case "warn":
		return "▲"
	case "error":
		return "✕"
	default:
		return "○"
	}
}
func statusPill(s string) string {
	switch s {
	case "ok":
		return lipgloss.NewStyle().Foreground(cOk).Bold(true).Render("● всё в норме")
	case "warn":
		return lipgloss.NewStyle().Foreground(cWarn).Bold(true).Render("▲ есть предупреждения")
	case "error":
		return lipgloss.NewStyle().Foreground(cErr).Bold(true).Render("✕ есть ошибки")
	default:
		return stDim.Render("… загрузка")
	}
}
func ruName(n string) string {
	switch n {
	case "postgres":
		return "База данных"
	case "remna":
		return "Remnawave"
	case "telegram_bot":
		return "Telegram-бот"
	case "disk":
		return "Диск"
	case "ram":
		return "Память"
	case "api_uptime":
		return "API аптайм"
	default:
		return n
	}
}
func clip(s string, n int) string {
	if n <= 0 {
		return ""
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	if n == 1 {
		return "…"
	}
	return string(r[:n-1]) + "…"
}
func grp(n int) string {
	s := fmt.Sprintf("%d", n)
	neg := strings.HasPrefix(s, "-")
	if neg {
		s = s[1:]
	}
	var out []byte
	for i := 0; i < len(s); i++ {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, ' ')
		}
		out = append(out, s[i])
	}
	r := string(out)
	if neg {
		r = "-" + r
	}
	return r
}
func money(v float64, cur string) string {
	num := grp(int(v + 0.5))
	switch strings.ToUpper(cur) {
	case "USD":
		return "$" + num
	case "EUR":
		return num + " €"
	case "RUB", "RUR", "":
		return num + " ₽"
	default:
		return num + " " + cur
	}
}
func fmtUptime(s int64) string {
	if s <= 0 {
		return "—"
	}
	d := s / 86400
	h := (s % 86400) / 3600
	m := (s % 3600) / 60
	switch {
	case d > 0:
		return fmt.Sprintf("%dд %dч", d, h)
	case h > 0:
		return fmt.Sprintf("%dч %dм", h, m)
	default:
		return fmt.Sprintf("%dм", m)
	}
}
func metaGet(h *health, name, key string) (float64, bool) {
	if h == nil {
		return 0, false
	}
	for _, c := range h.Checks {
		if c.Name == name {
			if v, ok := c.Meta[key]; ok {
				if f, ok2 := v.(float64); ok2 { // json-числа → float64
					return f, true
				}
			}
		}
	}
	return 0, false
}

// панель с рамкой фикс-размера (outerW×outerH). Контент клипается по высоте → нет прокрутки.
func panel(title, body string, outerW, outerH int, border lipgloss.Color) string {
	head := lipgloss.NewStyle().Foreground(cMuted).Bold(true).Render(title)
	// Height задаёт высоту КОНТЕНТА (рамка +2 сверху/снизу). MaxHeight здесь НЕ ставим:
	// он считает полную высоту с рамкой и срезал бы нижнюю границу. clipLines не даёт
	// контенту превысить область, а глобальный MaxHeight(H) на кадре — от прокрутки.
	inner := clipLines(head+"\n\n"+body, outerH-2)
	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).BorderForeground(border).
		Padding(0, 1).
		Width(outerW - 2).Height(outerH - 2).
		Render(inner)
}

// KPI-плитка: label / крупное значение / подпись, фикс-высота 3 (outer 5)
func tile(label, value, sub string, w int, valColor, borderColor lipgloss.Color) string {
	iw := w - 4
	l := lipgloss.NewStyle().Foreground(cMuted).Render(clip(label, iw))
	v := lipgloss.NewStyle().Foreground(valColor).Bold(true).Render(clip(value, iw))
	s := lipgloss.NewStyle().Foreground(cDim).Render(clip(sub, iw))
	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).BorderForeground(borderColor).
		Padding(0, 1).Width(w - 2).Height(3).
		Render(l + "\n" + v + "\n" + s)
}

func gauge(label string, pct float64, w int, extra string) string {
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	barW := w - 6
	if barW < 6 {
		barW = 6
	}
	filled := int(pct/100*float64(barW) + 0.5)
	if filled > barW {
		filled = barW
	}
	col := cOk
	if pct >= 85 {
		col = cErr
	} else if pct >= 70 {
		col = cWarn
	}
	bar := lipgloss.NewStyle().Foreground(col).Render(strings.Repeat("█", filled)) +
		lipgloss.NewStyle().Foreground(cDim).Render(strings.Repeat("░", barW-filled))
	head := stMuted.Render(label) + " " +
		lipgloss.NewStyle().Foreground(col).Bold(true).Render(fmt.Sprintf("%.0f%%", pct))
	return head + "\n" + bar + "\n" + stDim.Render(clip(extra, w)) + "\n\n"
}
func kv(k, v string, c lipgloss.Color) string {
	return stMuted.Render(fmt.Sprintf("%-15s ", k)) +
		lipgloss.NewStyle().Foreground(c).Bold(true).Render(v) + "\n"
}

// kvr — ключ + уже отрендеренное (со своими стилями) значение
func kvr(k, vRendered string) string {
	return stMuted.Render(fmt.Sprintf("%-15s ", k)) + vRendered + "\n"
}

// clipLines обрезает строку до n строк (защита панели от переполнения → нет прокрутки)
func clipLines(s string, n int) string {
	if n < 1 {
		n = 1
	}
	ls := strings.Split(s, "\n")
	if len(ls) <= n {
		return s
	}
	return strings.Join(ls[:n], "\n")
}

func (mo model) View() string {
	W, H := mo.w, mo.h
	if W < 8 {
		W = 8
	}
	if H < 6 {
		H = 6
	}
	name := mo.m.ServiceName
	if name == "" {
		name = "STEALTHNET"
	}
	overall := ""
	if mo.m.Health != nil {
		overall = mo.m.Health.Status
	}

	// мелкий терминал → компактный fallback (без прокрутки)
	if W < 100 || H < 26 {
		return mo.compact(W, H, name)
	}

	header := mo.header(W, name, overall)
	tiles := mo.tiles(W)
	footer := mo.footer(W)

	bodyH := H - lipgloss.Height(header) - lipgloss.Height(tiles) - lipgloss.Height(footer)
	if bodyH < 6 {
		bodyH = 6
	}
	// три колонки во всю высоту: Службы | Ресурсы сервера | Клиенты и подписки
	c1 := W * 40 / 100
	c2 := W * 31 / 100
	c3 := W - c1 - c2 - 2
	p1 := panel("СЛУЖБЫ", mo.servicesBody(c1-4), c1, bodyH, cDim)
	p2 := panel("РЕСУРСЫ СЕРВЕРА", mo.resourcesBody(c2-4), c2, bodyH, cDim)
	p3 := panel("КЛИЕНТЫ И ПОДПИСКИ", mo.bizBody(), c3, bodyH, cDim)
	body := lipgloss.JoinHorizontal(lipgloss.Top, p1, " ", p2, " ", p3)

	frame := lipgloss.JoinVertical(lipgloss.Left, header, tiles, body, footer)
	return lipgloss.NewStyle().MaxWidth(W).MaxHeight(H).Render(frame)
}

func (mo model) header(W int, name, overall string) string {
	iw := W - 4
	left := stTitle.Render("🖥  "+name) + stMuted.Render("   консоль мониторинга панели")
	pill := statusPill(overall)
	gap := iw - lipgloss.Width(left) - lipgloss.Width(pill)
	if gap < 1 {
		gap = 1
	}
	line := left + strings.Repeat(" ", gap) + pill
	return lipgloss.NewStyle().
		Border(lipgloss.RoundedBorder()).BorderForeground(cBrand).
		Padding(0, 1).Width(W - 2).Height(1).
		Render(line)
}

func (mo model) tiles(W int) string {
	const nn = 4
	tileW := (W - (nn - 1)) / nn
	used := tileW*nn + (nn - 1)
	last := tileW + (W - used)

	cl, su, rv := mo.m.Clients, mo.m.Subscriptions, mo.m.Revenue
	t1 := tile("КЛИЕНТЫ", grp(cl.Total),
		fmt.Sprintf("+%d сегодня · %d за неделю", cl.NewToday, cl.NewWeek), tileW, cInk, cBrand)
	t2 := tile("АКТИВНЫЕ ПОДПИСКИ", grp(su.Active),
		fmt.Sprintf("%d автопрод. · %d ≤3дн", su.AutoRenew, su.ExpiringSoon), tileW, cOk, cOk)
	t3 := tile("ДОХОД СЕГОДНЯ", money(rv.Today, rv.Currency),
		fmt.Sprintf("%d платеж(ей)", rv.TodayCount), tileW, cGold, cGold)
	t4 := tile("ДОХОД ЗА МЕСЯЦ", money(rv.Month, rv.Currency),
		fmt.Sprintf("%d платеж(ей)", rv.MonthCount), last, cGold, cGold)
	return lipgloss.JoinHorizontal(lipgloss.Top, t1, " ", t2, " ", t3, " ", t4)
}

func (mo model) servicesBody(innerW int) string {
	var b strings.Builder
	if mo.m.Health != nil && len(mo.m.Health.Checks) > 0 {
		for _, c := range mo.m.Health.Checks {
			st := statusStyle(c.Status)
			ms := ""
			if c.DurationMs > 0 {
				ms = stDim.Render(fmt.Sprintf("%6dms", c.DurationMs))
			}
			b.WriteString(fmt.Sprintf("%s  %s %s %s\n",
				st.Render(statusIcon(c.Status)),
				stInk.Render(fmt.Sprintf("%-13s", ruName(c.Name))),
				st.Render(fmt.Sprintf("%-5s", strings.ToUpper(c.Status))),
				ms))
			if (c.Status == "error" || c.Status == "warn") && c.Detail != "" {
				b.WriteString(stDim.Render("     "+clip(c.Detail, innerW-5)) + "\n")
			}
		}
	} else {
		b.WriteString(stDim.Render("нет данных") + "\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func (mo model) resourcesBody(innerW int) string {
	var b strings.Builder
	if p, ok := metaGet(mo.m.Health, "disk", "percent"); ok {
		free, _ := metaGet(mo.m.Health, "disk", "availKb")
		tot, _ := metaGet(mo.m.Health, "disk", "totalKb")
		b.WriteString(gauge("Диск", p, innerW,
			fmt.Sprintf("%.1f / %.1f GB свободно", free/1048576, tot/1048576)))
	}
	if p, ok := metaGet(mo.m.Health, "ram", "percent"); ok {
		free, _ := metaGet(mo.m.Health, "ram", "freeMb")
		tot, _ := metaGet(mo.m.Health, "ram", "totalMb")
		b.WriteString(gauge("Память", p, innerW,
			fmt.Sprintf("%.0f / %.0f MB свободно", free, tot)))
	}
	sv := mo.m.Server
	b.WriteString(kv("Аптайм хоста", fmtUptime(sv.UptimeSec), cInk))
	loadCol := cOk
	if sv.CPUCount > 0 && sv.LoadAvg > float64(sv.CPUCount) {
		loadCol = cErr
	} else if sv.CPUCount > 0 && sv.LoadAvg > float64(sv.CPUCount)*0.7 {
		loadCol = cWarn
	}
	b.WriteString(kv("Нагрузка (1м)", fmt.Sprintf("%.2f", sv.LoadAvg), loadCol))
	b.WriteString(kv("Ядер CPU", fmt.Sprintf("%d", sv.CPUCount), cInk))
	return strings.TrimRight(b.String(), "\n")
}

func (mo model) bizBody() string {
	cl, su, rv := mo.m.Clients, mo.m.Subscriptions, mo.m.Revenue
	sec := lipgloss.NewStyle().Foreground(cBrand).Bold(true)
	blkCol := cInk
	if cl.Blocked > 0 {
		blkCol = cWarn
	}
	expCol := cInk
	if su.ExpiringSoon > 0 {
		expCol = cWarn
	}
	gold := lipgloss.NewStyle().Foreground(cGold).Bold(true)
	var b strings.Builder
	b.WriteString(sec.Render("Клиенты") + "\n")
	b.WriteString(kv("  Всего", grp(cl.Total), cInk))
	b.WriteString(kv("  Заблокировано", grp(cl.Blocked), blkCol))
	b.WriteString(kv("  Новых сегодня", grp(cl.NewToday), cInk))
	b.WriteString(kv("  За неделю", grp(cl.NewWeek), cInk))
	b.WriteString("\n")
	b.WriteString(sec.Render("Подписки") + "\n")
	b.WriteString(kv("  Активных", grp(su.Active), cOk))
	b.WriteString(kv("  Автопродление", grp(su.AutoRenew), cInk))
	b.WriteString(kv("  Истекают ≤3д", grp(su.ExpiringSoon), expCol))
	b.WriteString("\n")
	b.WriteString(sec.Render("Доход") + "\n")
	b.WriteString(kvr("  Сегодня", gold.Render(money(rv.Today, rv.Currency))+stDim.Render(fmt.Sprintf("  (%d)", rv.TodayCount))))
	b.WriteString(kvr("  За месяц", gold.Render(money(rv.Month, rv.Currency))+stDim.Render(fmt.Sprintf("  (%d)", rv.MonthCount))))
	return strings.TrimRight(b.String(), "\n")
}

func (mo model) footer(W int) string {
	upd := "—"
	if !mo.updated.IsZero() {
		upd = mo.updated.In(msk).Format("15:04:05")
	}
	var line string
	if mo.errMsg != "" {
		line = lipgloss.NewStyle().Foreground(cErr).Render("⚠ метрики: "+clip(mo.errMsg, W-16)) +
			stDim.Render("  · авто 5с")
	} else {
		line = stDim.Render(fmt.Sprintf("обновлено %s МСК · авто 5с · ", upd)) +
			stMuted.Render("r") + stDim.Render(" — обновить · ") +
			stMuted.Render("q") + stDim.Render(" — выход · read-only")
	}
	if W < 160 || mo.h < 45 {
		line += lipgloss.NewStyle().Foreground(cWarn).Render("   ↔ лучший вид ≥160×45")
	}
	return lipgloss.NewStyle().Width(W).Height(1).MaxHeight(1).Render(line)
}

func (mo model) compact(W, H int, name string) string {
	var b strings.Builder
	b.WriteString(stTitle.Render("🖥  "+name) + "\n")
	b.WriteString(stDim.Render("разверни окно до ≥160×45 для полного дашборда") + "\n\n")
	cl, su, rv := mo.m.Clients, mo.m.Subscriptions, mo.m.Revenue
	b.WriteString(stMuted.Render("Клиентов:  ") + stInk.Render(grp(cl.Total)) +
		stDim.Render(fmt.Sprintf("  (+%d сегодня)", cl.NewToday)) + "\n")
	b.WriteString(stMuted.Render("Подписок:  ") + stInk.Render(grp(su.Active)) + "\n")
	b.WriteString(stMuted.Render("Доход дн:  ") + lipgloss.NewStyle().Foreground(cGold).Bold(true).Render(money(rv.Today, rv.Currency)) + "\n")
	b.WriteString(stMuted.Render("Доход мес: ") + lipgloss.NewStyle().Foreground(cGold).Bold(true).Render(money(rv.Month, rv.Currency)) + "\n\n")
	if mo.m.Health != nil {
		for _, c := range mo.m.Health.Checks {
			st := statusStyle(c.Status)
			b.WriteString("  " + st.Render(statusIcon(c.Status)) + " " +
				stInk.Render(ruName(c.Name)) + " " + st.Render(strings.ToUpper(c.Status)) + "\n")
		}
	}
	b.WriteString("\n" + stDim.Render("r — обновить · q — выход"))
	return lipgloss.NewStyle().MaxWidth(W).MaxHeight(H).Render(b.String())
}
