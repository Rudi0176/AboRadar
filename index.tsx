
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI } from "@google/genai";
import jsPDF from 'jspdf';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);


// --- TYPES AND CONSTANTS ---

type View = 'start' | 'abos' | 'auswertung' | 'kuendigungen' | 'einstellungen';
type SnackbarType = 'success' | 'error';
type Theme = 'light' | 'dark';

interface Subscription {
  id: string;
  name: string;
  price: number;
  interval: 'weekly' | 'monthly' | 'yearly';
  startDate: string;
  category: string;
  contractTermInMonths?: number;
  cancellationNoticePeriod?: number;
  cancellationNoticeUnit?: 'days' | 'weeks' | 'months';
}

const COMMON_SUBSCRIPTIONS = [
  'Netflix',
  'Spotify',
  'Amazon Prime',
  'Disney+',
  'YouTube Premium',
  'Adobe Creative Cloud',
  'DAZN',
  'Apple Music',
  'iCloud+',
  'Microsoft 365',
];

const CATEGORIES = ['Streaming', 'Software', 'Versicherung', 'Sport', 'Mobilfunk', 'Gaming', 'Sonstiges'];


const INITIAL_FORM_STATE = {
    name: '',
    price: '',
    interval: 'monthly' as 'weekly' | 'monthly' | 'yearly',
    startDate: new Date().toISOString().split('T')[0],
    category: '',
    contractTermInMonths: '',
    cancellationNoticePeriod: '',
    cancellationNoticeUnit: 'months' as 'days' | 'weeks' | 'months',
};

const EXPENSIVE_THRESHOLD_MONTHLY = 20;


// --- HELPER FUNCTIONS ---

const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(amount);
};

const getMonthlyCost = (sub: Subscription): number => {
    switch (sub.interval) {
        case 'monthly':
            return sub.price;
        case 'yearly':
            return sub.price / 12;
        case 'weekly':
            return (sub.price * 52) / 12;
        default:
            return 0;
    }
};

const calculateCancellationDeadline = (sub: Subscription): Date | null => {
    const { startDate, contractTermInMonths, cancellationNoticePeriod, cancellationNoticeUnit } = sub;

    if (!contractTermInMonths || contractTermInMonths <= 0 || !cancellationNoticePeriod || !cancellationNoticeUnit) {
        return null;
    }

    const start = new Date(startDate);
    const endDate = new Date(start.getTime());
    endDate.setMonth(start.getMonth() + contractTermInMonths);

    const deadline = new Date(endDate.getTime());
    switch (cancellationNoticeUnit) {
        case 'days':
            deadline.setDate(endDate.getDate() - cancellationNoticePeriod);
            break;
        case 'weeks':
            deadline.setDate(endDate.getDate() - cancellationNoticePeriod * 7);
            break;
        case 'months':
            deadline.setMonth(endDate.getMonth() - cancellationNoticePeriod);
            break;
    }
    return deadline;
};


// --- REACT COMPONENTS ---

const Snackbar = ({ message, type, visible }: { message: string, type: string, visible: boolean }) => {
    if (!visible) return null;

    return (
        <div className={`snackbar ${type} ${visible ? 'show' : ''}`}>
            {message}
        </div>
    );
};

const SummaryCard = ({ title, amount }: { title: string, amount: number }) => (
    <div className="summary-card">
        <h2>{title}</h2>
        <p>{formatCurrency(amount)}</p>
    </div>
);

const Welcome = () => (
    <div className="welcome-container">
        <h2>Willkommen bei AboRadar!</h2>
        <p>Behalte den Überblick über deine Abos, verwalte Kosten und verpasse keine Kündigungsfrist mehr. Wechsle zur Seite "Abos", um deinen ersten Vertrag hinzuzufügen.</p>
    </div>
);


const SubscriptionCard = ({ sub, onDelete, onEdit, isExpensive }: { sub: Subscription, onDelete: (id: string) => void, onEdit: (sub: Subscription) => void, isExpensive: boolean }) => {
    const deadline = useMemo(() => calculateCancellationDeadline(sub), [sub]);
    const intervalTextMap = {
        weekly: 'Woche',
        monthly: 'Monat',
        yearly: 'Jahr',
    };
    const intervalText = intervalTextMap[sub.interval];

    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    const WARNING_LEAD_TIME = 30;
    const leadTimeDate = new Date();
    leadTimeDate.setDate(now.getDate() + WARNING_LEAD_TIME);

    const isDeadlineSoon = deadline && deadline >= now && deadline <= leadTimeDate;
    
    const handleDeleteClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onDelete(sub.id);
    };

    const handleEditClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onEdit(sub);
    };

    return (
        <div className={`subscription-card ${isExpensive ? 'expensive' : ''}`} aria-label={`Abonnement: ${sub.name}`}>
            <div className="card-header">
                <h3>{sub.name}</h3>
                <div className="card-actions">
                    <button onClick={handleEditClick} className="card-action-btn" aria-label={`Bearbeite ${sub.name}`}>
                        <span className="material-icons">edit</span>
                    </button>
                     <button onClick={handleDeleteClick} className="card-action-btn" aria-label={`Lösche ${sub.name}`}>
                        <span className="material-icons">delete</span>
                    </button>
                </div>
            </div>
            <div className="subscription-info">
                <p className="price-info">{formatCurrency(sub.price)} / {intervalText}</p>
                 <span className="detail-item category-badge" title="Kategorie">
                    <span className="material-icons">label</span>
                    {sub.category}
                </span>

                {isExpensive && (
                    <div className="savings-badge" title="Dieses Abo kostet mehr als 20 € pro Monat.">
                        <span className="material-icons">lightbulb</span>
                        <span>Einsparpotenzial</span>
                    </div>
                )}
                
                {isDeadlineSoon && (
                    <div className="deadline-warning" title={`Kündigungsfrist endet am ${deadline.toLocaleDateString('de-DE')}`}>
                        <span className="material-icons">warning</span>
                        <span>Frist läuft bald ab – jetzt kündigen!</span>
                    </div>
                )}
                
                <div className="subscription-details">
                     <span className="detail-item" title="Erste Zahlung">
                        <span className="material-icons">event_available</span>
                        Start: {new Date(sub.startDate).toLocaleDateString('de-DE')}
                    </span>
                    
                    {!sub.contractTermInMonths || !sub.cancellationNoticePeriod ? (
                         <span className="detail-item" title="Vertragslaufzeit">
                            <span className="material-icons">autorenew</span>
                            Flexibel kündbar
                        </span>
                    ) : (
                         <>
                            <span className="detail-item" title="Vertragslaufzeit">
                                <span className="material-icons">hourglass_bottom</span>
                                {sub.contractTermInMonths} Monate Laufzeit
                            </span>
                            {deadline && (
                                <span className="detail-item" title="Kündigungsdatum">
                                    <span className="material-icons">event_busy</span>
                                    Kündbar bis: {deadline.toLocaleDateString('de-DE')}
                                </span>
                            )}
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};


const AddSubscriptionModal = ({ isOpen, onClose, onSave, editingSubscription, subscriptions }: { isOpen: boolean; onClose: () => void; onSave: (sub: Subscription) => void; editingSubscription: Subscription | null; subscriptions: Subscription[] }) => {
    if (!isOpen) return null;

    const suggestionList = useMemo(() => {
        const existingNames = subscriptions.map(s => s.name);
        const combined = new Set([...COMMON_SUBSCRIPTIONS, ...existingNames]);
        return Array.from(combined).sort((a, b) => a.localeCompare(b));
    }, [subscriptions]);
    
    const categorySuggestionList = useMemo(() => {
        const existingCategories = subscriptions.map(s => s.category).filter(Boolean);
        const combined = new Set([...CATEGORIES, ...existingCategories]);
        return Array.from(combined).sort((a, b) => a.localeCompare(b));
    }, [subscriptions]);

    const getInitialStateForSub = (sub: Subscription | null) => {
        if (sub) {
            return {
                name: sub.name,
                price: sub.price.toString(),
                interval: sub.interval,
                startDate: sub.startDate,
                category: sub.category || '',
                contractTermInMonths: sub.contractTermInMonths?.toString() ?? '',
                cancellationNoticePeriod: sub.cancellationNoticePeriod?.toString() ?? '',
                cancellationNoticeUnit: sub.cancellationNoticeUnit ?? 'months',
            };
        }
        return INITIAL_FORM_STATE;
    };
    
    const [formState, setFormState] = useState(() => getInitialStateForSub(editingSubscription));
    const [suggestionsVisible, setSuggestionsVisible] = useState(false);
    const autocompleteWrapperRef = useRef<HTMLDivElement>(null);
    const [categorySuggestionsVisible, setCategorySuggestionsVisible] = useState(false);
    const categoryAutocompleteWrapperRef = useRef<HTMLDivElement>(null);

    const filteredSuggestions = useMemo(() => {
        if (!formState.name) return suggestionList;
        return suggestionList.filter(s =>
            s.toLowerCase().includes(formState.name.toLowerCase())
        );
    }, [formState.name, suggestionList]);

    const filteredCategorySuggestions = useMemo(() => {
        if (!formState.category) return categorySuggestionList;
        return categorySuggestionList.filter(c =>
            c.toLowerCase().includes(formState.category.toLowerCase())
        );
    }, [formState.category, categorySuggestionList]);


    useEffect(() => {
        setFormState(getInitialStateForSub(editingSubscription));
    }, [editingSubscription]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (autocompleteWrapperRef.current && !autocompleteWrapperRef.current.contains(event.target as Node)) {
                setSuggestionsVisible(false);
            }
            if (categoryAutocompleteWrapperRef.current && !categoryAutocompleteWrapperRef.current.contains(event.target as Node)) {
                setCategorySuggestionsVisible(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormState(prev => ({ ...prev, [name]: value }));
    };
    
    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormState(prev => ({ ...prev, name: e.target.value }));
        if (!suggestionsVisible) {
            setSuggestionsVisible(true);
        }
    };

    const handleSuggestionClick = (nameValue: string) => {
        setFormState(prev => ({ ...prev, name: nameValue }));
        setSuggestionsVisible(false);
    };

    const handleCategoryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormState(prev => ({ ...prev, category: e.target.value }));
        if (!categorySuggestionsVisible) {
            setCategorySuggestionsVisible(true);
        }
    };

    const handleCategorySuggestionClick = (categoryValue: string) => {
        setFormState(prev => ({ ...prev, category: categoryValue }));
        setCategorySuggestionsVisible(false);
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!formState.name.trim() || !formState.price) {
            alert('Bitte fülle Name und Preis aus.');
            return;
        }
        
        const price = parseFloat(formState.price);
        const contractTermInMonths = formState.contractTermInMonths ? parseInt(formState.contractTermInMonths, 10) : undefined;
        const cancellationNoticePeriod = formState.cancellationNoticePeriod ? parseInt(formState.cancellationNoticePeriod, 10) : undefined;
        
        const subscriptionData: Subscription = {
            id: editingSubscription ? editingSubscription.id : new Date().toISOString(),
            name: formState.name.trim(),
            price: isNaN(price) ? 0 : price,
            interval: formState.interval,
            startDate: formState.startDate,
            category: formState.category.trim() || 'Sonstiges',
            contractTermInMonths: isNaN(contractTermInMonths) ? undefined : contractTermInMonths,
            cancellationNoticePeriod: isNaN(cancellationNoticePeriod) ? undefined : cancellationNoticePeriod,
            cancellationNoticeUnit: formState.cancellationNoticeUnit,
        };

        onSave(subscriptionData);
        onClose();
    };
    
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h2>{editingSubscription ? 'Abo bearbeiten' : 'Neues Abo hinzufügen'}</h2>
                <form onSubmit={handleSubmit}>
                     <div className="form-group autocomplete-wrapper" ref={autocompleteWrapperRef}>
                        <label htmlFor="name">Abo-Name</label>
                        <input
                            type="text"
                            id="name"
                            name="name"
                            value={formState.name}
                            onChange={handleNameChange}
                            onFocus={() => setSuggestionsVisible(true)}
                            placeholder="z.B. Netflix oder Fitnessstudio"
                            required
                            autoComplete="off"
                        />
                        {suggestionsVisible && filteredSuggestions.length > 0 && (
                            <ul className="suggestion-list">
                                {filteredSuggestions.map((subName) => (
                                    <li key={subName} onClick={() => handleSuggestionClick(subName)}>
                                        {subName}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    <div className="form-group">
                        <label htmlFor="price">Preis (€)</label>
                        <input
                            type="number"
                            id="price"
                            name="price"
                            value={formState.price}
                            onChange={handleChange}
                            placeholder="15.99"
                            step="0.01"
                            required
                        />
                    </div>
                     <div className="form-group autocomplete-wrapper" ref={categoryAutocompleteWrapperRef}>
                        <label htmlFor="category">Kategorie</label>
                        <input
                            type="text"
                            id="category"
                            name="category"
                            value={formState.category}
                            onChange={handleCategoryChange}
                            onFocus={() => setCategorySuggestionsVisible(true)}
                            placeholder="z.B. Streaming"
                            autoComplete="off"
                        />
                        {categorySuggestionsVisible && filteredCategorySuggestions.length > 0 && (
                            <ul className="suggestion-list">
                                {filteredCategorySuggestions.map((catName) => (
                                    <li key={catName} onClick={() => handleCategorySuggestionClick(catName)}>
                                        {catName}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                    <div className="form-group">
                        <label htmlFor="interval">Zahlungsintervall</label>
                        <select id="interval" name="interval" value={formState.interval} onChange={handleChange}>
                            <option value="weekly">Wöchentlich</option>
                            <option value="monthly">Monatlich</option>
                            <option value="yearly">Jährlich</option>
                        </select>
                    </div>
                     <div className="form-group">
                        <label htmlFor="startDate">Erste Zahlung am</label>
                        <input type="date" id="startDate" name="startDate" value={formState.startDate} onChange={handleChange} />
                    </div>
                     <div className="form-group">
                        <label htmlFor="contractTermInMonths">Vertragslaufzeit (in Monaten)</label>
                        <input type="number" id="contractTermInMonths" name="contractTermInMonths" value={formState.contractTermInMonths} onChange={handleChange} placeholder="z.B. 12 (0 für flexibel)" />
                    </div>
                    <div className="form-group">
                         <label>Kündigungsfrist</label>
                        <div className="form-group-inline">
                            <input type="number" name="cancellationNoticePeriod" value={formState.cancellationNoticePeriod} onChange={handleChange} placeholder="z.B. 3" />
                            <select name="cancellationNoticeUnit" value={formState.cancellationNoticeUnit} onChange={handleChange}>
                                <option value="days">Tage</option>
                                <option value="weeks">Wochen</option>
                                <option value="months">Monate</option>
                            </select>
                        </div>
                    </div>
                    <div className="modal-actions">
                        <button type="button" className="modal-btn btn-secondary" onClick={onClose}>Abbrechen</button>
                        <button type="submit" className="modal-btn btn-primary">Speichern</button>
                    </div>
                </form>
            </div>
        </div>
    );
};


// --- PAGE COMPONENTS ---

const StartPage = ({ subscriptions, monthlyTotal, yearlyTotal }: { subscriptions: Subscription[], monthlyTotal: number, yearlyTotal: number }) => (
    <>
        <section className="summary-container" aria-label="Kostenübersicht">
            <SummaryCard title="Monatlich" amount={monthlyTotal} />
            <SummaryCard title="Jährlich" amount={yearlyTotal} />
        </section>
        {subscriptions.length === 0 ? (
            <Welcome />
        ) : (
            <div className="welcome-back">
                <h2>Willkommen zurück!</h2>
                <p>Deine Kostenübersicht findest du oben. Wähle "Abos", um alle deine Verträge zu sehen.</p>
            </div>
        )}
    </>
);

const SubscriptionsListPage = ({ subscriptions, onDelete, onEdit, onAdd }: { subscriptions: Subscription[], onDelete: (id: string) => void, onEdit: (sub: Subscription) => void, onAdd: () => void }) => (
    <section aria-label="Abonnementliste">
        <div className="subscriptions-page-header">
            <h2 className="subscriptions-header">Deine Abos</h2>
            <button className="btn-add-subscription" onClick={onAdd}>Abo hinzufügen</button>
        </div>
        
        {subscriptions.length > 0 ? (
            <div className="subscription-list">
                {subscriptions.map((sub: Subscription) => (
                    <SubscriptionCard 
                        key={sub.id} 
                        sub={sub} 
                        onDelete={onDelete}
                        onEdit={onEdit}
                        isExpensive={getMonthlyCost(sub) > EXPENSIVE_THRESHOLD_MONTHLY}
                    />
                ))}
            </div>
        ) : (
            <div className="empty-state-container">
                <span className="material-icons empty-state-icon">receipt_long</span>
                <h3>Noch keine Abos hier</h3>
                <p>Füge dein erstes Abo hinzu, um loszulegen.</p>
            </div>
        )}
    </section>
);


const CancellationEditorPage = ({ template, onReset }: { template: string, onReset: () => void }) => {
    const [showOptionalFields, setShowOptionalFields] = useState(false);
    const [placeholders, setPlaceholders] = useState({
        'AnbieterName': '',
        'AnbieterStraße': '',
        'AnbieterPLZOrt': '',
        'Vorname': '',
        'Nachname': '',
        'EigeneStraße': '',
        'EigenePLZ': '',
        'EigenerOrt': '',
        'Datum': new Date().toLocaleDateString('de-DE'),
        'Kundennummer': '',
        'Vertragsnummer': '',
    });

    const handlePlaceholderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setPlaceholders(prev => ({...prev, [name]: value}));
    };
    
    const finalLetter = useMemo(() => {
        if (!template) return '';
        let letter = template;

        if (!placeholders.Vertragsnummer) {
            letter = letter.replace(/.*\[Vertragsnummer\].*\n?/g, '');
        }
    
        for (const key in placeholders) {
            const value = placeholders[key as keyof typeof placeholders];
            if (key === 'Vertragsnummer' && !value) {
                continue;
            }
            letter = letter.replace(new RegExp(`\\[${key}\\]`, 'g'), value || `[${key}]`);
        }
        return letter;
    }, [template, placeholders]);

    const handleDownloadPdf = () => {
        const doc = new jsPDF();
        doc.setFontSize(12);
        const lines = doc.splitTextToSize(finalLetter, 180); 
        doc.text(lines, 15, 20);
        doc.save('kuendigung.pdf');
    };

    const handleSendEmail = () => {
        const subject = encodeURIComponent(`Kündigungsschreiben`);
        const body = encodeURIComponent(finalLetter);
        window.location.href = `mailto:?subject=${subject}&body=${body}`;
    };

    const handleBack = () => {
        if (window.confirm('Bist du sicher? Die erstellte Kündigung wird gelöscht.')) {
            onReset();
        }
    };

    return (
        <section className="cancellation-generator-page">
            <h2 className="subscriptions-header">Kündigungsschreiben prüfen</h2>
            <div className="letter-preview">
                <pre>{finalLetter}</pre>
            </div>

            <div className="placeholder-form">
                <h3>Platzhalter ausfüllen</h3>
                <p className="page-description">Passe die Platzhalter an. Deine Daten werden nur für dieses Schreiben verwendet und nicht gespeichert.</p>
                
                <div className="form-section">
                    <h4>Empfänger (Anbieter)</h4>
                    <div className="form-group">
                        <label htmlFor="AnbieterName">Anbieter Name</label>
                        <input type="text" id="AnbieterName" name="AnbieterName" value={placeholders.AnbieterName} onChange={handlePlaceholderChange} placeholder="z.B. Fitness Center GmbH" />
                    </div>
                    <div className="form-group">
                        <label htmlFor="AnbieterStraße">Anbieter Straße + Nr.</label>
                        <input type="text" id="AnbieterStraße" name="AnbieterStraße" value={placeholders.AnbieterStraße} onChange={handlePlaceholderChange} placeholder="z.B. Sportallee 123"/>
                    </div>
                    <div className="form-group">
                        <label htmlFor="AnbieterPLZOrt">Anbieter PLZ + Ort</label>
                        <input type="text" id="AnbieterPLZOrt" name="AnbieterPLZOrt" value={placeholders.AnbieterPLZOrt} onChange={handlePlaceholderChange} placeholder="z.B. 98765 Sportstadt"/>
                    </div>
                </div>

                <div className="form-section">
                    <h4>Absender (Deine Daten)</h4>
                    <div className="form-group">
                        <label htmlFor="Vorname">Vorname</label>
                        <input type="text" id="Vorname" name="Vorname" value={placeholders.Vorname} onChange={handlePlaceholderChange} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="Nachname">Nachname</label>
                        <input type="text" id="Nachname" name="Nachname" value={placeholders.Nachname} onChange={handlePlaceholderChange} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="EigeneStraße">Straße + Nr.</label>
                        <input type="text" id="EigeneStraße" name="EigeneStraße" value={placeholders.EigeneStraße} onChange={handlePlaceholderChange} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="EigenePLZ">PLZ</label>
                        <input type="text" id="EigenePLZ" name="EigenePLZ" value={placeholders.EigenePLZ} onChange={handlePlaceholderChange} />
                    </div>
                    <div className="form-group">
                        <label htmlFor="EigenerOrt">Ort</label>
                        <input type="text" id="EigenerOrt" name="EigenerOrt" value={placeholders.EigenerOrt} onChange={handlePlaceholderChange} />
                    </div>
                </div>

                <div className="form-section">
                    <h4>Vertragsdetails</h4>
                    <div className="form-group">
                        <label htmlFor="Kundennummer">Kunden- oder Mitgliedsnummer</label>
                        <input type="text" id="Kundennummer" name="Kundennummer" value={placeholders.Kundennummer} onChange={handlePlaceholderChange} placeholder="Erforderlich zur Zuordnung"/>
                    </div>

                    {!showOptionalFields ? (
                        <button type="button" className="btn-add-optional" onClick={() => setShowOptionalFields(true)}>
                            <span className="material-icons">add</span>
                            Vertragsnummer hinzufügen
                        </button>
                    ) : (
                        <div className="form-group">
                            <label htmlFor="Vertragsnummer">Vertragsnummer</label>
                            <div className="input-with-action">
                                <input type="text" id="Vertragsnummer" name="Vertragsnummer" value={placeholders.Vertragsnummer} onChange={handlePlaceholderChange} />
                                <button
                                    type="button"
                                    className="btn-remove-optional"
                                    aria-label="Feld entfernen"
                                    onClick={() => {
                                        setShowOptionalFields(false);
                                        const event = { target: { name: 'Vertragsnummer', value: '' } } as React.ChangeEvent<HTMLInputElement>;
                                        handlePlaceholderChange(event);
                                    }}>
                                    <span className="material-icons">close</span>
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            
            <div className="editor-actions">
                <button onClick={handleDownloadPdf} className="modal-btn btn-primary"><span className="material-icons">download</span> Als PDF herunterladen</button>
                <button onClick={handleSendEmail} className="modal-btn btn-primary"><span className="material-icons">email</span> Per E-Mail senden</button>
                <button onClick={handleBack} className="modal-btn btn-secondary">Kündigung zurücksetzen</button>
            </div>
        </section>
    );
};


const CancellationsPage = ({ subscriptions, onDelete, onEdit, onTemplateGenerated }: { subscriptions: Subscription[], onDelete: (id: string) => void, onEdit: (sub: Subscription) => void, onTemplateGenerated: (template: string) => void }) => {
    const [activeTab, setActiveTab] = useState<'overview' | 'create'>('overview');
    
    const upcomingCancellations = useMemo(() => {
        const now = new Date();
        const ninetyDaysFromNow = new Date();
        ninetyDaysFromNow.setDate(now.getDate() + 90);

        return subscriptions
            .map(sub => ({ sub, deadline: calculateCancellationDeadline(sub) }))
            .filter(({ deadline }) => deadline && deadline >= now && deadline <= ninetyDaysFromNow)
            .sort((a, b) => a.deadline.getTime() - b.deadline.getTime())
            .map(({ sub }) => sub);
    }, [subscriptions]);

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [contractType, setContractType] = useState('Handyvertrag');
    const [additionalInfo, setAdditionalInfo] = useState('');

    const handleGenerate = async () => {
        setIsLoading(true);
        setError('');
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const prompt = `Erstelle ein formelles Kündigungsschreiben für einen ${contractType}. Berücksichtige diesen zusätzlichen Wunsch des Nutzers: "${additionalInfo}". Das Schreiben soll in einem professionellen und höflichen Ton verfasst sein. Verwende exakt die folgenden Platzhalter und keine anderen: [AnbieterName], [AnbieterStraße], [AnbieterPLZOrt], [Vorname], [Nachname], [EigeneStraße], [EigenePLZ], [EigenerOrt], [Datum], [Kundennummer], [Vertragsnummer]. Platziere die Vertragsnummer auf einer eigenen Zeile, zum Beispiel als "Vertragsnummer: [Vertragsnummer]", damit sie bei Bedarf weggelassen werden kann. Gib nur den Text des Schreibens ohne weitere Erklärungen oder Formatierungen zurück.`;
            
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
            });

            const text = response.text;

            if (!text) {
                throw new Error('Die KI hat keine Antwort geliefert. Bitte versuche es erneut.');
            }
            
            onTemplateGenerated(text);

        } catch (err) {
            console.error("Error generating cancellation letter:", err);
            setError('Fehler beim Erstellen des Textes. Bitte überprüfe deine Verbindung und versuche es später erneut.');
        } finally {
            setIsLoading(false);
        }
    };


    return (
        <section aria-label="Kündigungen">
            <div className="tabs-container">
                 <button onClick={() => setActiveTab('overview')} className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}>
                    Übersicht
                </button>
                <button onClick={() => setActiveTab('create')} className={`tab-button ${activeTab === 'create' ? 'active' : ''}`}>
                    Kündigung erstellen
                </button>
            </div>
            
            <div className="tab-content">
                {activeTab === 'overview' && (
                    <>
                        <h2 className="subscriptions-header">Anstehende Kündigungen</h2>
                        <p className="page-description">Hier siehst du Abos, deren Kündigungsfrist in den nächsten 90 Tagen endet.</p>
                        {upcomingCancellations.length > 0 ? (
                            <div className="subscription-list">
                                {upcomingCancellations.map(sub => (
                                    <SubscriptionCard 
                                        key={sub.id} 
                                        sub={sub} 
                                        onDelete={onDelete}
                                        onEdit={onEdit}
                                        isExpensive={getMonthlyCost(sub) > EXPENSIVE_THRESHOLD_MONTHLY}
                                    />
                                ))}
                            </div>
                        ) : (
                            <p className="empty-list-info">In den nächsten 90 Tagen stehen keine Kündigungen an. Gut geplant!</p>
                        )}
                    </>
                )}

                {activeTab === 'create' && (
                    <div className="cancellation-generator-page">
                        <h2 className="subscriptions-header">Kündigung erstellen</h2>
                        <p className="page-description">Lass dir von der KI ein formelles Kündigungsschreiben erstellen. Deine persönlichen Daten werden dabei nicht übermittelt.</p>

                        <div className="form-group">
                            <label htmlFor="contractType">Art des Vertrags</label>
                            <select id="contractType" value={contractType} onChange={(e) => setContractType(e.target.value)}>
                                <option>Handyvertrag</option>
                                <option>Streamingdienst</option>
                                <option>Fitnessstudio</option>
                                <option>Versicherung</option>
                                <option>Sonstiges</option>
                            </select>
                        </div>

                        <div className="form-group">
                            <label htmlFor="additionalInfo">Zusätzliche Informationen (optional)</label>
                            <textarea id="additionalInfo" value={additionalInfo} onChange={(e) => setAdditionalInfo(e.target.value)} placeholder="z.B. Ich möchte wegen Umzug kündigen." rows={3}></textarea>
                        </div>
                        
                        {error && <p className="error-message">{error}</p>}

                        <button className="btn-generate" onClick={handleGenerate} disabled={isLoading}>
                            {isLoading ? (
                                <>
                                    <div className="spinner"></div>
                                    <span>Wird erstellt...</span>
                                </>
                            ) : 'Kündigungstext erstellen lassen'}
                        </button>
                    </div>
                )}
            </div>
        </section>
    );
};


const StatisticsPage = ({ subscriptions, theme }: { subscriptions: Subscription[], theme: Theme }) => {
    const barChartRef = useRef<HTMLCanvasElement>(null);
    const doughnutChartRef = useRef<HTMLCanvasElement>(null);
    const barChartInstance = useRef<Chart | null>(null);
    const doughnutChartInstance = useRef<Chart | null>(null);

    useEffect(() => {
        // Destroy previous charts
        if (barChartInstance.current) barChartInstance.current.destroy();
        if (doughnutChartInstance.current) doughnutChartInstance.current.destroy();

        if (subscriptions.length === 0) return;

        // --- 1. Bar Chart: Monthly Costs ---
        if (barChartRef.current) {
            const monthlyCostData = Array(12).fill(0);
            const monthLabels: string[] = [];
            const today = new Date();

            for (let i = 11; i >= 0; i--) {
                const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
                const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
                const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0);
                
                monthLabels.push(date.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' }));

                subscriptions.forEach(sub => {
                    const subStartDate = new Date(sub.startDate);
                    if (subStartDate > monthEnd) return;

                    const deadline = calculateCancellationDeadline(sub);
                    if (deadline && deadline < monthStart) return;

                    monthlyCostData[11 - i] += getMonthlyCost(sub);
                });
            }

            const textColor = theme === 'dark' ? '#a0a0a0' : '#666666';
            const gridColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';

            barChartInstance.current = new Chart(barChartRef.current, {
                type: 'bar',
                data: {
                    labels: monthLabels,
                    datasets: [{
                        label: 'Monatliche Kosten',
                        data: monthlyCostData,
                        backgroundColor: 'rgba(0, 201, 167, 0.6)',
                        borderColor: 'rgba(0, 201, 167, 1)',
                        borderWidth: 1,
                        borderRadius: 4,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: { 
                            beginAtZero: true,
                            ticks: { color: textColor },
                            grid: { color: gridColor }
                        },
                        x: { 
                            ticks: { color: textColor },
                            grid: { display: false }
                        }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            callbacks: {
                                label: (context) => formatCurrency(context.parsed.y)
                            }
                        }
                    }
                }
            });
        }
        
        // --- 2. Doughnut Chart: Category Costs ---
        if (doughnutChartRef.current) {
            const categoryCosts: { [key: string]: number } = {};
            const now = new Date();
            
            subscriptions.forEach(sub => {
                const deadline = calculateCancellationDeadline(sub);
                if(deadline && deadline < now) return; // Skip inactive subs

                const category = sub.category || 'Sonstiges';
                categoryCosts[category] = (categoryCosts[category] || 0) + getMonthlyCost(sub);
            });
            
            const labels = Object.keys(categoryCosts);
            const data = Object.values(categoryCosts);
            const chartColors = ['#00C9A7', '#FFC300', '#FF5733', '#C70039', '#900C3F', '#581845', '#4E598C'];

            const textColor = theme === 'dark' ? '#e0e0e0' : '#333333';

            doughnutChartInstance.current = new Chart(doughnutChartRef.current, {
                type: 'doughnut',
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Kosten nach Kategorie',
                        data: data,
                        backgroundColor: chartColors,
                        borderColor: theme === 'dark' ? '#242424' : '#ffffff',
                        borderWidth: 2,
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: { 
                            position: 'bottom',
                            labels: { color: textColor }
                        },
                        tooltip: {
                            callbacks: {
                                label: (context) => `${context.label}: ${formatCurrency(context.parsed)}`
                            }
                        }
                    }
                }
            });
        }

        // Cleanup function
        return () => {
            if (barChartInstance.current) barChartInstance.current.destroy();
            if (doughnutChartInstance.current) doughnutChartInstance.current.destroy();
        };

    }, [subscriptions, theme]);


    if (subscriptions.length === 0) {
        return (
            <div className="empty-state-container">
                <span className="material-icons empty-state-icon">monitoring</span>
                <h3>Keine Daten zur Auswertung</h3>
                <p>Füge zuerst einige Abos hinzu, um deine Ausgaben hier zu sehen.</p>
            </div>
        );
    }
    
    return (
        <section className="statistics-page">
            <div className="chart-container">
                <h3 className="chart-title">Monatliche Gesamtkosten (Letzte 12 Monate)</h3>
                <div className="chart-wrapper">
                    <canvas ref={barChartRef}></canvas>
                </div>
            </div>
            <div className="chart-container">
                 <h3 className="chart-title">Kosten nach Kategorie</h3>
                <div className="chart-wrapper">
                    <canvas ref={doughnutChartRef}></canvas>
                </div>
            </div>
        </section>
    );
};


const InfoModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h2>Datenschutz bei AboRadar</h2>
                <p className="modal-text"><strong>Deine Daten gehören dir.</strong></p>
                <p className="modal-text">AboRadar wurde mit dem Grundsatz des Datenschutzes entwickelt. Alle Daten, die du eingibst – seien es deine Abonnements, Kosten oder Kündigungsfristen – werden ausschließlich auf deinem eigenen Gerät gespeichert. Sie verlassen niemals deinen Browser und werden nicht an uns oder Dritte gesendet.</p>
                <p className="modal-text">Auch die Funktion zur Erstellung von Kündigungsschreiben ist datenschutzfreundlich. Wir senden nur allgemeine, anonyme Informationen an die KI (z.B. "Erstelle ein Kündigungsschreiben für ein Fitnessstudio"). Deine persönlichen Daten wie Name oder Adresse werden erst auf deinem Gerät in die Vorlage eingefügt.</p>
                <div className="modal-actions">
                    <button type="button" className="modal-btn btn-primary" onClick={onClose}>Verstanden</button>
                </div>
            </div>
        </div>
    );
};

const SettingsPage = ({ theme, onThemeToggle }: { theme: Theme, onThemeToggle: () => void }) => {
    
    const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
    
    return (
        <section>
            <h2 className="subscriptions-header">Einstellungen</h2>

             <div className="settings-section">
                <h3>Darstellung</h3>
                <div className="settings-row">
                    <label htmlFor="darkModeToggle" className="settings-label with-icon">
                        <span className="material-icons">{theme === 'dark' ? 'dark_mode' : 'light_mode'}</span>
                        Dark Mode
                    </label>
                    <label className="toggle-switch">
                        <input
                            type="checkbox"
                            id="darkModeToggle"
                            checked={theme === 'dark'}
                            onChange={onThemeToggle}
                            aria-label="Dark Mode umschalten"
                        />
                        <span className="slider"></span>
                    </label>
                </div>
            </div>

            <div className="settings-section">
                 <h3>Info & Support</h3>
                 <div className="privacy-info-box">
                    <p><strong>Datenschutz-freundlich:</strong> AboRadar speichert keine personenbezogenen Daten auf Servern. Alle Daten bleiben sicher auf deinem Gerät.</p>
                 </div>
                 <button className="settings-button" onClick={() => setIsInfoModalOpen(true)}>
                    Mehr über den Datenschutz erfahren
                 </button>
                 <a href="mailto:support@aboradar.example.com" className="settings-button">
                    Feedback senden
                 </a>
            </div>
            
            <InfoModal isOpen={isInfoModalOpen} onClose={() => setIsInfoModalOpen(false)} />
        </section>
    );
};

const BottomNavBar = ({ activeView, setActiveView }: { activeView: View, setActiveView: (view: View) => void }) => {
    const navItems = [
        { id: 'start', icon: 'home', label: 'Start' },
        { id: 'abos', icon: 'article', label: 'Abos' },
        { id: 'auswertung', icon: 'bar_chart', label: 'Auswertung' },
        { id: 'kuendigungen', icon: 'notifications', label: 'Kündigungen' },
        { id: 'einstellungen', icon: 'settings', label: 'Einstellungen' },
    ] as const;

    return (
        <nav className="bottom-nav">
            {navItems.map(item => (
                <button
                    key={item.id}
                    className={`nav-item ${activeView === item.id ? 'active' : ''}`}
                    onClick={() => setActiveView(item.id)}
                    aria-label={item.label}
                    aria-current={activeView === item.id}
                >
                    <span className="material-icons">{item.icon}</span>
                    <span className="nav-label">{item.label}</span>
                </button>
            ))}
        </nav>
    );
};

const App = () => {
    const [subscriptions, setSubscriptions] = useState<Subscription[]>(() => {
        try {
            const savedSubs = localStorage.getItem('aboRadarSubscriptions');
            if (!savedSubs) return [];
            let parsedSubs = JSON.parse(savedSubs);
             if (Array.isArray(parsedSubs)) {
                // Data migration for category
                parsedSubs = parsedSubs.map(sub => ({
                    ...sub,
                    category: sub.category || 'Sonstiges' // Default to 'Sonstiges' if not present
                }));
                // Bereinige kaputte Einträge
                return parsedSubs.filter(sub => sub && sub.id && sub.name && typeof sub.price === 'number');
            }
            return [];
        } catch (error) {
            console.error("Could not load subscriptions from localStorage", error);
            return [];
        }
    });
    
    const [theme, setTheme] = useState<Theme>(() => {
        const savedTheme = localStorage.getItem('aboRadarTheme');
        if (savedTheme === 'light' || savedTheme === 'dark') {
            return savedTheme;
        }
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return 'dark';
        }
        return 'light';
    });

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [activeView, setActiveView] = useState<View>('start');
    const [editingSubscription, setEditingSubscription] = useState<Subscription | null>(null);
    const [cancellationTemplate, setCancellationTemplate] = useState<string | null>(null);
    const [snackbar, setSnackbar] = useState({ message: '', type: 'success' as SnackbarType, visible: false });

     const showSnackbar = (message: string, type: SnackbarType = 'success') => {
        setSnackbar({ message, type, visible: true });
        setTimeout(() => {
            setSnackbar(prev => ({ ...prev, visible: false }));
        }, 3000);
    };

    useEffect(() => {
        try {
            localStorage.setItem('aboRadarSubscriptions', JSON.stringify(subscriptions));
        } catch (error) {
            console.error("Could not save subscriptions to localStorage", error);
        }
    }, [subscriptions]);
    
    useEffect(() => {
        document.body.setAttribute('data-theme', theme);
        localStorage.setItem('aboRadarTheme', theme);
    }, [theme]);


    const { monthlyTotal, yearlyTotal } = useMemo(() => {
        const now = new Date();
        const activeSubs = subscriptions.filter(sub => {
            const deadline = calculateCancellationDeadline(sub);
            return !deadline || deadline >= now;
        });
        const total = activeSubs.reduce((sum, sub) => sum + getMonthlyCost(sub), 0);
        return { monthlyTotal: total, yearlyTotal: total * 12 };
    }, [subscriptions]);

    const handleSaveSubscription = (sub: Subscription) => {
        const index = subscriptions.findIndex(s => s.id === sub.id);
        if (index > -1) {
            // Editing
            const updatedSubs = [...subscriptions];
            updatedSubs[index] = sub;
            setSubscriptions(updatedSubs);
            showSnackbar(`"${sub.name}" wurde aktualisiert.`);
        } else {
            // Adding new
            const wasEmpty = subscriptions.length === 0;
            setSubscriptions(prevSubs => [...prevSubs, sub]);
            showSnackbar(`"${sub.name}" wurde hinzugefügt.`);
            if (wasEmpty) {
                setActiveView('abos');
            }
        }
    };

    const handleDeleteSubscription = (idToDelete: string) => {
        const subName = subscriptions.find(s => s.id === idToDelete)?.name;
        const newSubscriptions = subscriptions.filter(sub => sub.id !== idToDelete);
        setSubscriptions(newSubscriptions);
        if (subName) {
            showSnackbar(`"${subName}" wurde gelöscht.`);
        }
    };
    
    const handleDeleteAllData = () => {
        if (window.confirm('Alle gespeicherten Abos und Kündigungen werden unwiderruflich gelöscht. Bist du sicher?')) {
            setSubscriptions([]);
            setCancellationTemplate(null);
            showSnackbar('Alle Daten wurden gelöscht.');
            setActiveView('start');
        }
    };

    const handleOpenModal = (sub: Subscription | null) => {
        setEditingSubscription(sub);
        setIsModalOpen(true);
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingSubscription(null);
    };
    
    const handleTemplateGenerated = (template: string) => {
        setCancellationTemplate(template);
        showSnackbar('Kündigungsvorlage erfolgreich erstellt.');
    };

    const handleThemeToggle = () => {
        setTheme(prevTheme => (prevTheme === 'light' ? 'dark' : 'light'));
    };

    const renderContent = () => {
        switch (activeView) {
            case 'start':
                return <StartPage subscriptions={subscriptions} monthlyTotal={monthlyTotal} yearlyTotal={yearlyTotal} />;
            case 'abos':
                return <SubscriptionsListPage subscriptions={subscriptions} onDelete={handleDeleteSubscription} onEdit={handleOpenModal} onAdd={() => handleOpenModal(null)} />;
            case 'auswertung':
                return <StatisticsPage subscriptions={subscriptions} theme={theme} />;
            case 'kuendigungen':
                return <CancellationsPage subscriptions={subscriptions} onDelete={handleDeleteSubscription} onEdit={handleOpenModal} onTemplateGenerated={handleTemplateGenerated} />;
            case 'einstellungen':
                return <SettingsPage theme={theme} onThemeToggle={handleThemeToggle} />;
            default:
                 return <StartPage subscriptions={subscriptions} monthlyTotal={monthlyTotal} yearlyTotal={yearlyTotal} />;
        }
    };

    if (cancellationTemplate) {
        return (
            <div className="app-container">
                <header className="header">
                    <h1>AboRadar</h1>
                </header>
                <main>
                    <CancellationEditorPage 
                        template={cancellationTemplate} 
                        onReset={() => setCancellationTemplate(null)} 
                    />
                </main>
                 <Snackbar
                    message={snackbar.message}
                    type={snackbar.type}
                    visible={snackbar.visible}
                />
            </div>
        );
    }

    return (
        <div className="app-container">
            <header className="header">
                <h1>AboRadar</h1>
            </header>
            
            <main>
                {renderContent()}
            </main>

            <AddSubscriptionModal 
                isOpen={isModalOpen}
                onClose={handleCloseModal}
                onSave={handleSaveSubscription}
                editingSubscription={editingSubscription}
                subscriptions={subscriptions}
            />

            <Snackbar
                message={snackbar.message}
                type={snackbar.type}
                visible={snackbar.visible}
            />

            <BottomNavBar activeView={activeView} setActiveView={setActiveView} />
        </div>
    );
};

const container = document.getElementById('root');
if (container) {
    const root = createRoot(container);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}