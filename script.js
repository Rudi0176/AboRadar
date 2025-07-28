import { GoogleGenAI } from "@google/genai";
import jsPDF from 'jspdf';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

// --- CONSTANTS ---
const CATEGORIES = ['Streaming', 'Software', 'Versicherung', 'Sport', 'Mobilfunk', 'Gaming', 'Sonstiges'];
const COMMON_SUBSCRIPTIONS = ['Netflix', 'Spotify', 'Amazon Prime', 'Disney+', 'YouTube Premium', 'Adobe Creative Cloud', 'DAZN', 'Apple Music', 'iCloud+', 'Microsoft 365'];
const EXPENSIVE_THRESHOLD_MONTHLY = 20;

// --- STATE ---
let state = {
    subscriptions: [],
    theme: 'light',
    activeView: 'start',
    editingSubscriptionId: null,
    cancellationTemplate: null,
};
let chartInstances = { bar: null, doughnut: null };

// --- DOM ELEMENT SELECTORS ---
const mainContent = document.getElementById('main-content');
const bottomNav = document.querySelector('.bottom-nav');
const addSubscriptionModal = document.getElementById('add-subscription-modal');
const subscriptionForm = document.getElementById('subscription-form');
const modalTitle = document.getElementById('modal-title');
const infoModal = document.getElementById('info-modal');
const snackbar = document.getElementById('snackbar');
const autocompleteWrapper = document.querySelector('.autocomplete-wrapper');
const nameInput = document.getElementById('name');
const suggestionList = document.querySelector('.suggestion-list');

// --- HELPER FUNCTIONS ---
const formatCurrency = (amount) => new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
const getMonthlyCost = (sub) => {
    switch (sub.interval) {
        case 'monthly': return sub.price;
        case 'yearly': return sub.price / 12;
        case 'weekly': return (sub.price * 52) / 12;
        default: return 0;
    }
};
const calculateCancellationDeadline = (sub) => {
    const { startDate, contractTermInMonths, cancellationNoticePeriod, cancellationNoticeUnit } = sub;
    if (!contractTermInMonths || contractTermInMonths <= 0 || !cancellationNoticePeriod || !cancellationNoticeUnit) return null;
    const start = new Date(startDate);
    const endDate = new Date(start.getTime());
    endDate.setMonth(start.getMonth() + contractTermInMonths);
    const deadline = new Date(endDate.getTime());
    switch (cancellationNoticeUnit) {
        case 'days': deadline.setDate(endDate.getDate() - cancellationNoticePeriod); break;
        case 'weeks': deadline.setDate(endDate.getDate() - cancellationNoticePeriod * 7); break;
        case 'months': deadline.setMonth(endDate.getMonth() - cancellationNoticePeriod); break;
    }
    return deadline;
};

// --- LOCAL STORAGE & STATE MANAGEMENT ---
const saveState = () => {
    try {
        localStorage.setItem('aboRadarSubscriptions', JSON.stringify(state.subscriptions));
        localStorage.setItem('aboRadarTheme', state.theme);
        document.body.setAttribute('data-theme', state.theme);
    } catch (error) {
        console.error("Could not save state to localStorage", error);
    }
};
const loadState = () => {
    try {
        const savedSubs = localStorage.getItem('aboRadarSubscriptions');
        const savedTheme = localStorage.getItem('aboRadarTheme');
        
        if (savedSubs) {
            let parsedSubs = JSON.parse(savedSubs);
            if (Array.isArray(parsedSubs)) {
                 state.subscriptions = parsedSubs.filter(sub => sub && sub.id && sub.name && typeof sub.price === 'number')
                    .map(sub => ({ ...sub, category: sub.category || 'Sonstiges' }));
            }
        }
        
        if (savedTheme === 'light' || savedTheme === 'dark') {
            state.theme = savedTheme;
        } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            state.theme = 'dark';
        }
    } catch (error) {
        console.error("Could not load state from localStorage", error);
    }
    document.body.setAttribute('data-theme', state.theme);
};

// --- UI & RENDER FUNCTIONS ---
const showSnackbar = (message, type = 'success') => {
    snackbar.textContent = message;
    snackbar.className = `snackbar ${type} show`;
    setTimeout(() => {
        snackbar.className = snackbar.className.replace('show', '');
    }, 3000);
};

const renderSubscriptionCard = (sub) => {
    const deadline = calculateCancellationDeadline(sub);
    const intervalTextMap = { weekly: 'Woche', monthly: 'Monat', yearly: 'Jahr' };
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const WARNING_LEAD_TIME = 30;
    const leadTimeDate = new Date();
    leadTimeDate.setDate(now.getDate() + WARNING_LEAD_TIME);
    const isDeadlineSoon = deadline && deadline >= now && deadline <= leadTimeDate;
    const isExpensive = getMonthlyCost(sub) > EXPENSIVE_THRESHOLD_MONTHLY;

    const card = document.createElement('div');
    card.className = `subscription-card ${isExpensive ? 'expensive' : ''}`;
    card.setAttribute('aria-label', `Abonnement: ${sub.name}`);
    card.dataset.id = sub.id;

    let detailsHtml = `
        <span class="detail-item" title="Erste Zahlung">
            <span class="material-icons">event_available</span>
            Start: ${new Date(sub.startDate).toLocaleDateString('de-DE')}
        </span>`;

    if (!sub.contractTermInMonths || !sub.cancellationNoticePeriod) {
        detailsHtml += `
            <span class="detail-item" title="Vertragslaufzeit">
                <span class="material-icons">autorenew</span>
                Flexibel kündbar
            </span>`;
    } else {
        detailsHtml += `
            <span class="detail-item" title="Vertragslaufzeit">
                <span class="material-icons">hourglass_bottom</span>
                ${sub.contractTermInMonths} Monate Laufzeit
            </span>`;
        if (deadline) {
            detailsHtml += `
                <span class="detail-item" title="Kündigungsdatum">
                    <span class="material-icons">event_busy</span>
                    Kündbar bis: ${deadline.toLocaleDateString('de-DE')}
                </span>`;
        }
    }

    card.innerHTML = `
        <div class="card-header">
            <h3>${sub.name}</h3>
            <div class="card-actions">
                <button class="card-action-btn edit-btn" aria-label="Bearbeite ${sub.name}"><span class="material-icons">edit</span></button>
                <button class="card-action-btn delete-btn" aria-label="Lösche ${sub.name}"><span class="material-icons">delete</span></button>
            </div>
        </div>
        <div class="subscription-info">
            <p class="price-info">${formatCurrency(sub.price)} / ${intervalTextMap[sub.interval]}</p>
            <span class="detail-item category-badge" title="Kategorie"><span class="material-icons">label</span>${sub.category}</span>
            ${isExpensive ? `<div class="savings-badge" title="Dieses Abo kostet mehr als 20 € pro Monat."><span class="material-icons">lightbulb</span><span>Einsparpotenzial</span></div>` : ''}
            ${isDeadlineSoon ? `<div class="deadline-warning" title="Kündigungsfrist endet am ${deadline.toLocaleDateString('de-DE')}"><span class="material-icons">warning</span><span>Frist läuft bald ab – jetzt kündigen!</span></div>` : ''}
            <div class="subscription-details">${detailsHtml}</div>
        </div>
    `;
    return card;
};

const renderPage = (title, content) => {
    mainContent.innerHTML = `<h2 class="subscriptions-header">${title}</h2>${content}`;
};

const renderStartPage = () => {
    const now = new Date();
    const activeSubs = state.subscriptions.filter(sub => {
        const deadline = calculateCancellationDeadline(sub);
        return !deadline || deadline >= now;
    });
    const monthlyTotal = activeSubs.reduce((sum, sub) => sum + getMonthlyCost(sub), 0);
    const yearlyTotal = monthlyTotal * 12;

    mainContent.innerHTML = `
        <section class="summary-container" aria-label="Kostenübersicht">
            <div class="summary-card"><h2>Monatlich</h2><p>${formatCurrency(monthlyTotal)}</p></div>
            <div class="summary-card"><h2>Jährlich</h2><p>${formatCurrency(yearlyTotal)}</p></div>
        </section>
        ${state.subscriptions.length === 0 ? `
            <div class="welcome-container">
                <h2>Willkommen bei AboRadar!</h2>
                <p>Behalte den Überblick über deine Abos, verwalte Kosten und verpasse keine Kündigungsfrist mehr. Wechsle zur Seite "Abos", um deinen ersten Vertrag hinzuzufügen.</p>
            </div>
        ` : `
            <div class="welcome-back">
                <h2>Willkommen zurück!</h2>
                <p>Deine Kostenübersicht findest du oben. Wähle "Abos", um alle deine Verträge zu sehen.</p>
            </div>
        `}
    `;
};

const renderSubscriptionsListPage = () => {
    mainContent.innerHTML = `
        <section aria-label="Abonnementliste">
            <div class="subscriptions-page-header">
                <h2 class="subscriptions-header">Deine Abos</h2>
                <button class="btn-add-subscription" id="add-sub-btn">Abo hinzufügen</button>
            </div>
            <div class="subscription-list"></div>
        </section>`;
    
    const listContainer = mainContent.querySelector('.subscription-list');
    if (state.subscriptions.length > 0) {
        state.subscriptions.forEach(sub => listContainer.appendChild(renderSubscriptionCard(sub)));
    } else {
        listContainer.innerHTML = `
            <div class="empty-state-container">
                <span class="material-icons empty-state-icon">receipt_long</span>
                <h3>Noch keine Abos hier</h3>
                <p>Füge dein erstes Abo hinzu, um loszulegen.</p>
            </div>`;
    }
    document.getElementById('add-sub-btn').addEventListener('click', () => openSubscriptionModal(null));
    listContainer.addEventListener('click', (e) => {
        const target = e.target.closest('.card-action-btn');
        if (!target) return;
        const subId = target.closest('.subscription-card').dataset.id;
        if (target.classList.contains('edit-btn')) {
            openSubscriptionModal(subId);
        } else if (target.classList.contains('delete-btn')) {
            handleDeleteSubscription(subId);
        }
    });
};

const renderStatisticsPage = () => {
    if (state.subscriptions.length === 0) {
        mainContent.innerHTML = `
            <div class="empty-state-container">
                <span class="material-icons empty-state-icon">monitoring</span>
                <h3>Keine Daten zur Auswertung</h3>
                <p>Füge zuerst einige Abos hinzu, um deine Ausgaben hier zu sehen.</p>
            </div>`;
        return;
    }

    mainContent.innerHTML = `
        <section class="statistics-page">
            <div class="chart-container">
                <h3 class="chart-title">Monatliche Gesamtkosten (Letzte 12 Monate)</h3>
                <div class="chart-wrapper"><canvas id="bar-chart"></canvas></div>
            </div>
            <div class="chart-container">
                <h3 class="chart-title">Kosten nach Kategorie</h3>
                <div class="chart-wrapper"><canvas id="doughnut-chart"></canvas></div>
            </div>
        </section>`;
    
    // Destroy previous charts
    if (chartInstances.bar) chartInstances.bar.destroy();
    if (chartInstances.doughnut) chartInstances.doughnut.destroy();

    const textColor = state.theme === 'dark' ? '#a0a0a0' : '#666666';
    const gridColor = state.theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';

    // Bar Chart
    const barCtx = document.getElementById('bar-chart').getContext('2d');
    const monthlyCostData = Array(12).fill(0);
    const monthLabels = [];
    const today = new Date();
    for (let i = 11; i >= 0; i--) {
        const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
        monthLabels.push(date.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }));
        state.subscriptions.forEach(sub => {
            const subStartDate = new Date(sub.startDate);
            if (subStartDate > monthEnd) return;
            const deadline = calculateCancellationDeadline(sub);
            if (deadline && deadline < monthStart) return;
            monthlyCostData[11 - i] += getMonthlyCost(sub);
        });
    }
    chartInstances.bar = new Chart(barCtx, {
        type: 'bar',
        data: { labels: monthLabels, datasets: [{ label: 'Monatliche Kosten', data: monthlyCostData, backgroundColor: 'rgba(0, 201, 167, 0.6)', borderColor: 'rgba(0, 201, 167, 1)', borderWidth: 1, borderRadius: 4 }] },
        options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { color: textColor }, grid: { color: gridColor } }, x: { ticks: { color: textColor }, grid: { display: false } } }, plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => formatCurrency(c.parsed.y) } } } }
    });

    // Doughnut Chart
    const doughnutCtx = document.getElementById('doughnut-chart').getContext('2d');
    const categoryCosts = {};
    const now = new Date();
    state.subscriptions.forEach(sub => {
        const deadline = calculateCancellationDeadline(sub);
        if (deadline && deadline < now) return;
        const category = sub.category || 'Sonstiges';
        categoryCosts[category] = (categoryCosts[category] || 0) + getMonthlyCost(sub);
    });
    const labels = Object.keys(categoryCosts);
    const data = Object.values(categoryCosts);
    const chartColors = ['#00C9A7', '#FFC300', '#FF5733', '#C70039', '#900C3F', '#581845', '#4E598C'];
    chartInstances.doughnut = new Chart(doughnutCtx, {
        type: 'doughnut',
        data: { labels: labels, datasets: [{ label: 'Kosten nach Kategorie', data: data, backgroundColor: chartColors, borderColor: state.theme === 'dark' ? '#242424' : '#ffffff', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: textColor } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${formatCurrency(c.parsed)}` } } } }
    });
};

const renderCancellationsPage = () => {
    mainContent.innerHTML = `
        <section aria-label="Kündigungen">
            <div class="tabs-container">
                <button id="tab-overview" class="tab-button active">Übersicht</button>
                <button id="tab-create" class="tab-button">Kündigung erstellen</button>
            </div>
            <div id="tab-content" class="tab-content"></div>
        </section>`;
    
    const tabContent = document.getElementById('tab-content');
    const overviewTab = document.getElementById('tab-overview');
    const createTab = document.getElementById('tab-create');
    
    const renderOverview = () => {
        overviewTab.classList.add('active');
        createTab.classList.remove('active');
        const now = new Date();
        const ninetyDaysFromNow = new Date();
        ninetyDaysFromNow.setDate(now.getDate() + 90);
        const upcomingCancellations = state.subscriptions
            .map(sub => ({ sub, deadline: calculateCancellationDeadline(sub) }))
            .filter(({ deadline }) => deadline && deadline >= now && deadline <= ninetyDaysFromNow)
            .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
            .map(({ sub }) => sub);

        let content = `
            <h2 class="subscriptions-header">Anstehende Kündigungen</h2>
            <p class="page-description">Hier siehst du Abos, deren Kündigungsfrist in den nächsten 90 Tagen endet.</p>
            <div class="subscription-list"></div>`;
        tabContent.innerHTML = content;
        const listContainer = tabContent.querySelector('.subscription-list');
        if (upcomingCancellations.length > 0) {
            upcomingCancellations.forEach(sub => listContainer.appendChild(renderSubscriptionCard(sub)));
        } else {
            listContainer.innerHTML = `<p class="empty-list-info">In den nächsten 90 Tagen stehen keine Kündigungen an. Gut geplant!</p>`;
        }
         listContainer.addEventListener('click', (e) => {
            const target = e.target.closest('.card-action-btn');
            if (!target) return;
            const subId = target.closest('.subscription-card').dataset.id;
            if (target.classList.contains('edit-btn')) {
                openSubscriptionModal(subId);
            } else if (target.classList.contains('delete-btn')) {
                handleDeleteSubscription(subId);
            }
        });
    };

    const renderCreate = () => {
        createTab.classList.add('active');
        overviewTab.classList.remove('active');
        tabContent.innerHTML = `
            <div class="cancellation-generator-page">
                <h2 class="subscriptions-header">Kündigung erstellen</h2>
                <p class="page-description">Lass dir von der KI ein formelles Kündigungsschreiben erstellen. Deine persönlichen Daten werden dabei nicht übermittelt.</p>
                <div class="form-group">
                    <label for="contractType">Art des Vertrags</label>
                    <select id="contractType">
                        <option>Handyvertrag</option><option>Streamingdienst</option><option>Fitnessstudio</option><option>Versicherung</option><option>Sonstiges</option>
                    </select>
                </div>
                <div class="form-group">
                    <label for="additionalInfo">Zusätzliche Informationen (optional)</label>
                    <textarea id="additionalInfo" placeholder="z.B. Ich möchte wegen Umzug kündigen." rows="3"></textarea>
                </div>
                <p id="gen-error" class="error-message" style="display: none;"></p>
                <button class="btn-generate" id="generate-btn">Kündigungstext erstellen lassen</button>
            </div>`;
        document.getElementById('generate-btn').addEventListener('click', handleGenerateCancellation);
    };

    overviewTab.addEventListener('click', renderOverview);
    createTab.addEventListener('click', renderCreate);
    renderOverview(); // Initial view
};

const renderSettingsPage = () => {
    mainContent.innerHTML = `
        <section>
            <h2 class="subscriptions-header">Einstellungen</h2>
            <div class="settings-section">
                <h3>Darstellung</h3>
                <div class="settings-row">
                    <label for="darkModeToggle" class="settings-label with-icon">
                        <span class="material-icons">${state.theme === 'dark' ? 'dark_mode' : 'light_mode'}</span> Dark Mode
                    </label>
                    <label class="toggle-switch">
                        <input type="checkbox" id="darkModeToggle" ${state.theme === 'dark' ? 'checked' : ''}>
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            <div class="settings-section">
                <h3>Info & Support</h3>
                <div class="privacy-info-box">
                    <p><strong>Datenschutz-freundlich:</strong> AboRadar speichert keine personenbezogenen Daten auf Servern. Alle Daten bleiben sicher auf deinem Gerät.</p>
                </div>
                <button class="settings-button" id="show-info-btn">Mehr über den Datenschutz erfahren</button>
                <a href="mailto:support@aboradar.example.com" class="settings-button">Feedback senden</a>
            </div>
        </section>`;
    
    document.getElementById('darkModeToggle').addEventListener('change', () => {
        state.theme = state.theme === 'light' ? 'dark' : 'light';
        renderApp(); // Re-render to update icons etc.
    });
    document.getElementById('show-info-btn').addEventListener('click', () => infoModal.style.display = 'flex');
};


const renderCancellationEditorPage = () => {
    let placeholders = {
        'AnbieterName': '', 'AnbieterStraße': '', 'AnbieterPLZOrt': '',
        'Vorname': '', 'Nachname': '', 'EigeneStraße': '', 'EigenePLZ': '', 'EigenerOrt': '',
        'Datum': new Date().toLocaleDateString('de-DE'),
        'Kundennummer': '', 'Vertragsnummer': '',
    };
    let showOptionalFields = false;

    const updatePreview = () => {
        let letter = state.cancellationTemplate;
        if (!placeholders.Vertragsnummer) {
            letter = letter.replace(/.*\[Vertragsnummer\].*\n?/g, '');
        }
        for (const key in placeholders) {
            const value = placeholders[key];
            if (key === 'Vertragsnummer' && !value) continue;
            letter = letter.replace(new RegExp(`\\[${key}\\]`, 'g'), value || `[${key}]`);
        }
        document.getElementById('letter-preview-pre').textContent = letter;
    };
    
    const render = () => {
        mainContent.innerHTML = `
            <section class="cancellation-generator-page">
                <h2 class="subscriptions-header">Kündigungsschreiben prüfen</h2>
                <div class="letter-preview"><pre id="letter-preview-pre"></pre></div>
                <div class="placeholder-form">
                    <h3>Platzhalter ausfüllen</h3>
                    <p class="page-description">Passe die Platzhalter an. Deine Daten werden nur für dieses Schreiben verwendet und nicht gespeichert.</p>
                    <div class="form-section">
                        <h4>Empfänger (Anbieter)</h4>
                        <div class="form-group"><label for="AnbieterName">Anbieter Name</label><input type="text" id="AnbieterName" name="AnbieterName" placeholder="z.B. Fitness Center GmbH"></div>
                        <div class="form-group"><label for="AnbieterStraße">Anbieter Straße + Nr.</label><input type="text" id="AnbieterStraße" name="AnbieterStraße" placeholder="z.B. Sportallee 123"></div>
                        <div class="form-group"><label for="AnbieterPLZOrt">Anbieter PLZ + Ort</label><input type="text" id="AnbieterPLZOrt" name="AnbieterPLZOrt" placeholder="z.B. 98765 Sportstadt"></div>
                    </div>
                    <div class="form-section">
                        <h4>Absender (Deine Daten)</h4>
                        <div class="form-group"><label for="Vorname">Vorname</label><input type="text" id="Vorname" name="Vorname"></div>
                        <div class="form-group"><label for="Nachname">Nachname</label><input type="text" id="Nachname" name="Nachname"></div>
                        <div class="form-group"><label for="EigeneStraße">Straße + Nr.</label><input type="text" id="EigeneStraße" name="EigeneStraße"></div>
                        <div class="form-group"><label for="EigenePLZ">PLZ</label><input type="text" id="EigenePLZ" name="EigenePLZ"></div>
                        <div class="form-group"><label for="EigenerOrt">Ort</label><input type="text" id="EigenerOrt" name="EigenerOrt"></div>
                    </div>
                    <div class="form-section">
                        <h4>Vertragsdetails</h4>
                        <div class="form-group"><label for="Kundennummer">Kunden- oder Mitgliedsnummer</label><input type="text" id="Kundennummer" name="Kundennummer" placeholder="Erforderlich zur Zuordnung"></div>
                        <div id="optional-fields-container"></div>
                    </div>
                </div>
                <div class="editor-actions">
                    <button id="download-pdf" class="modal-btn btn-primary"><span class="material-icons">download</span> Als PDF herunterladen</button>
                    <button id="send-email" class="modal-btn btn-primary"><span class="material-icons">email</span> Per E-Mail senden</button>
                    <button id="reset-cancellation" class="modal-btn btn-secondary">Kündigung zurücksetzen</button>
                </div>
            </section>`;

        const optionalContainer = document.getElementById('optional-fields-container');
        if (showOptionalFields) {
            optionalContainer.innerHTML = `
                <div class="form-group">
                    <label for="Vertragsnummer">Vertragsnummer</label>
                    <div class="input-with-action">
                        <input type="text" id="Vertragsnummer" name="Vertragsnummer">
                        <button type="button" class="btn-remove-optional" id="remove-optional-btn" aria-label="Feld entfernen">
                            <span class="material-icons">close</span>
                        </button>
                    </div>
                </div>`;
            document.getElementById('remove-optional-btn').addEventListener('click', () => {
                showOptionalFields = false;
                placeholders.Vertragsnummer = '';
                render();
            });
        } else {
            optionalContainer.innerHTML = `
                <button type="button" class="btn-add-optional" id="add-optional-btn">
                    <span class="material-icons">add</span> Vertragsnummer hinzufügen
                </button>`;
            document.getElementById('add-optional-btn').addEventListener('click', () => {
                showOptionalFields = true;
                render();
            });
        }

        updatePreview();

        mainContent.querySelectorAll('input').forEach(input => {
            input.value = placeholders[input.name] || '';
            input.addEventListener('input', (e) => {
                placeholders[e.target.name] = e.target.value;
                updatePreview();
            });
        });
        
        document.getElementById('download-pdf').addEventListener('click', () => {
            const doc = new jsPDF();
            doc.setFontSize(12);
            const letter = document.getElementById('letter-preview-pre').textContent;
            const lines = doc.splitTextToSize(letter, 180);
            doc.text(lines, 15, 20);
            doc.save('kuendigung.pdf');
        });

        document.getElementById('send-email').addEventListener('click', () => {
            const letter = document.getElementById('letter-preview-pre').textContent;
            const subject = encodeURIComponent('Kündigungsschreiben');
            const body = encodeURIComponent(letter);
            window.location.href = `mailto:?subject=${subject}&body=${body}`;
        });

        document.getElementById('reset-cancellation').addEventListener('click', () => {
            if (window.confirm('Bist du sicher? Die erstellte Kündigung wird gelöscht.')) {
                state.cancellationTemplate = null;
                renderApp();
            }
        });
    };

    render();
};


// --- EVENT HANDLERS & LOGIC ---
const handleNavClick = (e) => {
    const button = e.target.closest('.nav-item');
    if (button && button.dataset.view !== state.activeView) {
        state.activeView = button.dataset.view;
        renderApp();
    }
};

const openSubscriptionModal = (subId) => {
    state.editingSubscriptionId = subId;
    subscriptionForm.reset();
    suggestionList.style.display = 'none';

    // Populate category dropdown
    const categorySelect = document.getElementById('category');
    categorySelect.innerHTML = CATEGORIES.map(cat => `<option value="${cat}">${cat}</option>`).join('');
    
    if (subId) {
        modalTitle.textContent = 'Abo bearbeiten';
        const sub = state.subscriptions.find(s => s.id === subId);
        if (sub) {
            Object.keys(sub).forEach(key => {
                const input = subscriptionForm.elements[key];
                if (input) input.value = sub[key] ?? '';
            });
        }
    } else {
        modalTitle.textContent = 'Neues Abo hinzufügen';
        subscriptionForm.elements['startDate'].value = new Date().toISOString().split('T')[0];
    }
    addSubscriptionModal.style.display = 'flex';
};

const closeSubscriptionModal = () => {
    addSubscriptionModal.style.display = 'none';
    state.editingSubscriptionId = null;
};

const handleSubscriptionFormSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(subscriptionForm);
    const subData = Object.fromEntries(formData.entries());

    const subscription = {
        id: state.editingSubscriptionId || new Date().toISOString(),
        name: subData.name.trim(),
        price: parseFloat(subData.price),
        interval: subData.interval,
        startDate: subData.startDate,
        category: subData.category,
        contractTermInMonths: subData.contractTermInMonths ? parseInt(subData.contractTermInMonths, 10) : undefined,
        cancellationNoticePeriod: subData.cancellationNoticePeriod ? parseInt(subData.cancellationNoticePeriod, 10) : undefined,
        cancellationNoticeUnit: subData.cancellationNoticeUnit,
    };
    
    if (state.editingSubscriptionId) {
        const index = state.subscriptions.findIndex(s => s.id === state.editingSubscriptionId);
        state.subscriptions[index] = subscription;
        showSnackbar(`"${subscription.name}" wurde aktualisiert.`);
    } else {
        const wasEmpty = state.subscriptions.length === 0;
        state.subscriptions.push(subscription);
        showSnackbar(`"${subscription.name}" wurde hinzugefügt.`);
        if(wasEmpty) state.activeView = 'abos';
    }
    
    closeSubscriptionModal();
    renderApp();
};

const handleDeleteSubscription = (idToDelete) => {
    const subName = state.subscriptions.find(s => s.id === idToDelete)?.name;
    if (window.confirm(`Bist du sicher, dass du "${subName}" löschen möchtest?`)) {
        state.subscriptions = state.subscriptions.filter(sub => sub.id !== idToDelete);
        showSnackbar(`"${subName}" wurde gelöscht.`);
        renderApp();
    }
};

const handleGenerateCancellation = async (e) => {
    const btn = e.currentTarget;
    const errorEl = document.getElementById('gen-error');
    btn.disabled = true;
    btn.innerHTML = `<div class="spinner"></div><span>Wird erstellt...</span>`;
    errorEl.style.display = 'none';

    try {
        const contractType = document.getElementById('contractType').value;
        const additionalInfo = document.getElementById('additionalInfo').value;
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const prompt = `Erstelle ein formelles Kündigungsschreiben für einen ${contractType}. Berücksichtige diesen zusätzlichen Wunsch des Nutzers: "${additionalInfo}". Das Schreiben soll in einem professionellen und höflichen Ton verfasst sein. Verwende exakt die folgenden Platzhalter und keine anderen: [AnbieterName], [AnbieterStraße], [AnbieterPLZOrt], [Vorname], [Nachname], [EigeneStraße], [EigenePLZ], [EigenerOrt], [Datum], [Kundennummer], [Vertragsnummer]. Platziere die Vertragsnummer auf einer eigenen Zeile, zum Beispiel als "Vertragsnummer: [Vertragsnummer]", damit sie bei Bedarf weggelassen werden kann. Gib nur den Text des Schreibens ohne weitere Erklärungen oder Formatierungen zurück.`;
        
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: prompt });
        const text = response.text;

        if (!text) throw new Error('Die KI hat keine Antwort geliefert.');

        state.cancellationTemplate = text;
        showSnackbar('Kündigungsvorlage erfolgreich erstellt.');
        renderApp();

    } catch (err) {
        console.error("Error generating cancellation letter:", err);
        errorEl.textContent = 'Fehler beim Erstellen des Textes. Bitte versuche es später erneut.';
        errorEl.style.display = 'block';
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Kündigungstext erstellen lassen';
    }
};

const handleAutocomplete = () => {
    const existingNames = state.subscriptions.map(s => s.name);
    const combined = new Set([...COMMON_SUBSCRIPTIONS, ...existingNames]);
    const suggestionPool = Array.from(combined).sort((a, b) => a.localeCompare(b));

    const value = nameInput.value.toLowerCase();
    if (!value) {
        suggestionList.style.display = 'none';
        return;
    }
    const filtered = suggestionPool.filter(s => s.toLowerCase().includes(value));
    
    suggestionList.innerHTML = '';
    if (filtered.length) {
        filtered.forEach(s => {
            const li = document.createElement('li');
            li.textContent = s;
            li.addEventListener('click', () => {
                nameInput.value = s;
                suggestionList.style.display = 'none';
            });
            suggestionList.appendChild(li);
        });
        suggestionList.style.display = 'block';
    } else {
        suggestionList.style.display = 'none';
    }
};

// --- APP INITIALIZATION & MAIN RENDER LOOP ---
const renderApp = () => {
    saveState();
    
    // Update active nav button style
    document.querySelectorAll('.nav-item').forEach(btn => {
        const isCurrent = btn.dataset.view === state.activeView;
        btn.classList.toggle('active', isCurrent);
        btn.setAttribute('aria-current', String(isCurrent));
    });

    if (state.cancellationTemplate) {
        renderCancellationEditorPage();
    } else {
        switch (state.activeView) {
            case 'start': renderStartPage(); break;
            case 'abos': renderSubscriptionsListPage(); break;
            case 'auswertung': renderStatisticsPage(); break;
            case 'kuendigungen': renderCancellationsPage(); break;
            case 'einstellungen': renderSettingsPage(); break;
            default: renderStartPage();
        }
    }
};

const init = () => {
    loadState();
    
    // Event Listeners
    bottomNav.addEventListener('click', handleNavClick);
    subscriptionForm.addEventListener('submit', handleSubscriptionFormSubmit);
    addSubscriptionModal.addEventListener('click', (e) => {
        if (e.target.id === 'add-subscription-modal' || e.target.id === 'modal-cancel-btn') {
            closeSubscriptionModal();
        }
    });
    infoModal.addEventListener('click', (e) => {
        if (e.target.id === 'info-modal' || e.target.id === 'info-modal-close-btn') {
            infoModal.style.display = 'none';
        }
    });
    nameInput.addEventListener('input', handleAutocomplete);
    nameInput.addEventListener('focus', handleAutocomplete);
    document.addEventListener('click', (e) => {
        if (!autocompleteWrapper.contains(e.target)) {
            suggestionList.style.display = 'none';
        }
    });

    renderApp();
};

// Start the app
init();
