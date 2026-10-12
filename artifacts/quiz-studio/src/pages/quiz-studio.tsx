import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  Crown,
  ExternalLink,
  LoaderCircle,
  LockKeyhole,
  PartyPopper,
  Plus,
  Radio,
  Share2,
  Sparkles,
  Trophy,
  Users,
  X,
} from 'lucide-react';
import {
  getGetAttemptQueryKey,
  getGetLeaderboardQueryKey,
  getGetQuizEditorQueryKey,
  getGetQuizQueryKey,
  getListQuizzesQueryKey,
  useCreateQuiz,
  useFinishAttempt,
  useGetAttempt,
  useGetLeaderboard,
  useGetQuiz,
  useGetQuizEditor,
  useListQuizzes,
  useNavigateAttempt,
  usePublishQuiz,
  useStartAttempt,
  useStartCompetition,
  useStopCompetition,
  useSubmitAnswer,
  useUpdateQuiz,
} from '@workspace/api-client-react';
import type { Attempt, QuizInput, QuizQuestionInput, QuizSummary } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';

type ThemeKey = QuizInput['theme'];
type QuizQuestionDraft = QuizQuestionInput & { _key: string };
type EditorForm = Omit<QuizInput, 'questions'> & { questions: QuizQuestionDraft[] };

const themeDetails: { key: ThemeKey; title: string; note: string; className: string }[] = [
  { key: 'playful', title: 'Fun & Playful', note: 'Bright colors, cheerful motion, rounded details', className: 'swatch-playful' },
  { key: 'modern', title: 'Modern', note: 'Fresh gradients and contemporary polish', className: 'swatch-modern' },
  { key: 'tech', title: 'Tech', note: 'Dark surfaces with electric accents', className: 'swatch-tech' },
  { key: 'minimal', title: 'Minimal', note: 'Quiet color, clear type, open space', className: 'swatch-minimal' },
  { key: 'professional', title: 'Professional', note: 'Structured, elegant, and easy to read', className: 'swatch-professional' },
  { key: 'gamified', title: 'Colorful & Gamified', note: 'Vibrant rewards, points, and game energy', className: 'swatch-gamified' },
];

const blankQuestion = (): QuizQuestionDraft => ({
  _key: `${Date.now()}-${Math.random()}`,
  prompt: '',
  options: ['', '', '', ''],
  correctOption: 0,
  timeLimitSeconds: 20,
});

const emptyQuiz = (): EditorForm => ({
  title: '',
  description: '',
  mode: 'static',
  timerMode: 'none',
  totalDurationMinutes: null,
  theme: 'playful',
  questions: [blankQuestion()],
});

const tokenFor = (code?: string) => {
  if (!code || typeof localStorage === 'undefined') return '';
  return localStorage.getItem(`quiz-creator-${code}`) ?? '';
};

const creatorRequest = (code?: string) => ({
  headers: { 'X-Creator-Token': tokenFor(code) },
});

const classNames = (...items: (string | false | undefined)[]) => items.filter(Boolean).join(' ');

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return (
    <div className="app-shell min-h-[100dvh]">
      <header className="topbar">
        <Link href="/" className="brand" data-testid="link-home">
          <span className="brand-mark"><Sparkles size={19} strokeWidth={2.4} /></span>
          <span>quiz<span className="brand-italic">studio</span></span>
        </Link>
        <nav className="topnav" aria-label="Main navigation">
          <Link href="/" className={classNames('nav-link', location === '/' && 'nav-active')} data-testid="link-dashboard">My studio</Link>
          <Link href="/create" className="nav-create" data-testid="link-create">
            <Plus size={16} /> Create a quiz
          </Link>
        </nav>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <span>Make a little knowledge go a long way.</span>
        <span className="footer-mark">QUIZ STUDIO <span>·</span> PLAY WELL</span>
      </footer>
    </div>
  );
}

function PageLoading({ label = 'Getting your studio ready' }: { label?: string }) {
  return (
    <div className="loading-panel" role="status">
      <div className="skeleton-line skeleton-short" />
      <div className="skeleton-line skeleton-long" />
      <div className="skeleton-card" />
      <p><LoaderCircle size={15} className="spin" /> {label}</p>
    </div>
  );
}

function ErrorMessage({ retry }: { retry: () => void }) {
  return (
    <div className="error-panel">
      <CircleHelp size={23} />
      <h2>That didn’t load quite right.</h2>
      <p>Give it another try. Your work is still here.</p>
      <button className="button button-secondary" onClick={retry}>Try again</button>
    </div>
  );
}

function QuizArtwork({ theme = 'playful', compact = false }: { theme?: ThemeKey; compact?: boolean }) {
  return (
    <div className={classNames('quiz-artwork', `art-${theme}`, compact && 'art-compact')} aria-hidden="true">
      <span className="art-orbit orbit-one" />
      <span className="art-orbit orbit-two" />
      <span className="art-card">
        <span className="art-dots"><i /><i /><i /></span>
        <span className="art-scribble" />
        <span className="art-lines"><i /><i /><i /></span>
      </span>
      <span className="art-spark"><Sparkles size={34} /></span>
      <span className="art-sticker">Q</span>
    </div>
  );
}

function formatMode(quiz: Pick<QuizSummary, 'mode' | 'timerMode'>) {
  if (quiz.mode === 'competition') return 'Live competition';
  if (quiz.timerMode === 'per_question') return 'Quick-fire';
  if (quiz.timerMode === 'total') return 'Timed quiz';
  return 'At your own pace';
}

export function DashboardPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const quizzes = useListQuizzes({ query: { queryKey: getListQuizzesQueryKey(), refetchOnWindowFocus: true } });
  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState('');
  const items = quizzes.data ?? [];

  const goToQuiz = () => {
    if (!joinCode.trim()) {
      setJoinError('Enter the quiz code to continue.');
      return;
    }
    setJoinError('');
    setLocation(`/quiz/${encodeURIComponent(joinCode.trim())}`);
  };

  return (
    <AppShell>
      <div className="dashboard page-enter">
        <section className="welcome-row">
          <div>
            <p className="eyebrow"><span className="eyebrow-line" /> YOUR CREATOR SPACE</p>
            <h1 className="display-font">Good quizzes <em>stick.</em></h1>
            <p className="welcome-copy">Make something people can’t wait to play.</p>
          </div>
          <div className="welcome-actions">
            <Link href="/create" className="button button-primary" data-testid="button-create-quiz"><Plus size={17} /> Start a quiz</Link>
            <div className="join-box">
              <input
                aria-label="Quiz code"
                data-testid="input-join-code"
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && goToQuiz()}
                placeholder="Have a code?"
              />
              <button aria-label="Join quiz" onClick={goToQuiz} data-testid="button-join-quiz"><ArrowRight size={17} /></button>
            </div>
            {joinError && <span className="field-error">{joinError}</span>}
          </div>
        </section>

        <section className="welcome-banner">
          <div className="banner-copy">
            <span className="banner-kicker"><Sparkles size={14} /> YOUR NEXT BIG HIT</span>
            <h2>Curiosity looks<br />good on everyone.</h2>
            <p>Turn what you know into a moment everyone can share.</p>
            <Link href="/create" className="banner-link" data-testid="link-build-first">Build your first quiz <ArrowRight size={16} /></Link>
          </div>
          <div className="banner-art">
            <div className="banner-ring banner-ring-one" />
            <div className="banner-ring banner-ring-two" />
            <div className="banner-ticket"><span>Q</span><i /><i /><i /></div>
            <span className="banner-star star-a"><Sparkles size={30} /></span>
            <span className="banner-star star-b"><Sparkles size={22} /></span>
            <span className="banner-confetti" />
          </div>
        </section>

        <section className="quiz-library">
          <div className="section-heading">
            <div>
              <p className="eyebrow">THE GOOD STUFF</p>
              <h2>Your published quizzes</h2>
            </div>
            <span className="quiz-count">{items.length} {items.length === 1 ? 'quiz' : 'quizzes'}</span>
          </div>
          {quizzes.isLoading ? (
            <PageLoading label="Finding your quizzes" />
          ) : quizzes.isError ? (
            <ErrorMessage retry={() => queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() })} />
          ) : items.length === 0 ? (
            <div className="empty-library">
              <div className="empty-icon"><PartyPopper size={22} /></div>
              <div>
                <h3>A blank page is a good place to start.</h3>
                <p>Your published quizzes will live here. Make one worth sharing.</p>
              </div>
              <Link href="/create" className="button button-secondary" data-testid="button-create-empty">Create your first quiz <ArrowRight size={16} /></Link>
            </div>
          ) : (
            <div className="quiz-grid">
              {items.map((quiz, index) => (
                <Link href={`/quiz/${encodeURIComponent(quiz.code)}`} className="quiz-tile" key={quiz.code} data-testid={`card-quiz-${quiz.code}`}>
                  <div className="tile-art-wrap">
                    <QuizArtwork theme={quiz.theme} compact />
                    <span className="tile-index">0{index + 1}</span>
                  </div>
                  <div className="tile-content">
                    <div className="tile-meta"><span>{formatMode(quiz)}</span><span>{quiz.questionCount} questions</span></div>
                    <h3>{quiz.title}</h3>
                    <p>{quiz.description || 'A quiz made to be shared.'}</p>
                    <span className="tile-open">Open quiz <ArrowRight size={15} /></span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
        <div className="dashboard-note"><span className="note-dot" /> A good question can change the whole room.</div>
      </div>
    </AppShell>
  );
}

export function EditorPage() {
  const params = useParams<{ code?: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const searchCode = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('code') : null;
  const code = params.code || searchCode || undefined;
  const editorQuery = useGetQuizEditor(code ?? '', {
    query: { enabled: !!code, queryKey: getGetQuizEditorQueryKey(code ?? '') },
    request: creatorRequest(code),
  });
  const createQuiz = useCreateQuiz();
  const updateQuiz = useUpdateQuiz({ request: creatorRequest(code) });
  const publishQuiz = usePublishQuiz({ request: creatorRequest(code) });
  const [form, setForm] = useState<EditorForm>(emptyQuiz);
  const [initialized, setInitialized] = useState(false);
  const [publishAfterCreate, setPublishAfterCreate] = useState(false);
  const [notice, setNotice] = useState('');
  const busy = createQuiz.isPending || updateQuiz.isPending || publishQuiz.isPending;
  const locked = form.mode === 'competition' && !!code && editorQuery.data?.status === 'active';

  useEffect(() => {
    if (editorQuery.data && !initialized) {
      const quiz = editorQuery.data;
      setForm({
        title: quiz.title,
        description: quiz.description,
        mode: quiz.mode,
        timerMode: quiz.timerMode,
        totalDurationMinutes: quiz.totalDurationMinutes,
        theme: quiz.theme,
        questions: quiz.questions.map((question) => ({
          _key: question.id,
          prompt: question.prompt,
          options: [...question.options],
          correctOption: question.correctOption,
          timeLimitSeconds: question.timeLimitSeconds ?? 20,
        })),
      });
      setInitialized(true);
    }
  }, [editorQuery.data, initialized]);

  useEffect(() => {
    if (!publishAfterCreate || !code) return;
    setPublishAfterCreate(false);
    publishQuiz.mutate({ code }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
        setLocation(`/quiz/${encodeURIComponent(code)}`);
      },
      onError: () => setNotice('Draft created, but publishing failed. Try again.'),
    });
  }, [code, publishAfterCreate]);

  const setField = <K extends keyof EditorForm>(key: K, value: EditorForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setNotice('');
  };

  const updateQuestion = (index: number, patch: Partial<QuizQuestionDraft>) => {
    setForm((current) => ({
      ...current,
      questions: current.questions.map((question, questionIndex) => questionIndex === index ? { ...question, ...patch } : question),
    }));
  };

  const updateOption = (questionIndex: number, optionIndex: number, value: string) => {
    const question = form.questions[questionIndex] as QuizQuestionDraft;
    updateQuestion(questionIndex, { options: question.options.map((option, index) => index === optionIndex ? value : option) });
  };

  const addQuestion = () => setField('questions', [...form.questions, blankQuestion()]);
  const removeQuestion = (index: number) => setField('questions', form.questions.filter((_, i) => i !== index));

  const normalized = (): QuizInput => ({
    ...form,
    title: form.title.trim(),
    description: form.description.trim(),
    totalDurationMinutes: form.timerMode === 'total' ? Number(form.totalDurationMinutes) : null,
    questions: form.questions.map((question) => ({
      prompt: question.prompt.trim(),
      options: question.options.map((option) => option.trim()),
      correctOption: question.correctOption,
      timeLimitSeconds: form.timerMode === 'per_question' || form.mode === 'competition' ? Number(question.timeLimitSeconds) : undefined,
    })),
  });

  const validate = () => {
    if (!form.title.trim()) return 'Add a title before continuing.';
    if (!form.questions.length) return 'Add at least one question.';
    if (form.timerMode === 'total' && (!Number(form.totalDurationMinutes) || Number(form.totalDurationMinutes) < 1)) return 'Total duration must be at least one minute.';
    if (form.mode === 'competition' && form.timerMode === 'none') return 'Competitions need a timer. Choose per question or total time.';
    for (const [index, question] of form.questions.entries()) {
      if (!question.prompt.trim()) return `Question ${index + 1} needs a prompt.`;
      if (question.options.some((option) => !option.trim()) || question.options.length < 2) return `Add at least two answers to question ${index + 1}.`;
      if ((form.timerMode === 'per_question' || form.mode === 'competition') && (!Number(question.timeLimitSeconds) || Number(question.timeLimitSeconds) < 1)) return `Question ${index + 1} needs a positive time limit.`;
    }
    return '';
  };

  const save = (publish = false) => {
    const validation = validate();
    if (validation) {
      setNotice(validation);
      return;
    }
    const data = normalized();
    const afterSave = (savedCode: string) => {
      queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetQuizEditorQueryKey(savedCode) });
      if (publish) {
        publishQuiz.mutate({ code: savedCode }, {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListQuizzesQueryKey() });
            setLocation(`/quiz/${encodeURIComponent(savedCode)}`);
          },
          onError: () => setNotice('We saved your quiz, but couldn’t publish it. Try again.'),
        });
      } else {
        setNotice('Draft saved. Keep shaping it or publish when it’s ready.');
      }
    };
    if (code) {
      updateQuiz.mutate({ code, data }, { onSuccess: () => afterSave(code), onError: () => setNotice('Couldn’t save your changes. Check your creator token and try again.') });
    } else {
      createQuiz.mutate({ data }, {
        onSuccess: (created) => {
          localStorage.setItem(`quiz-creator-${created.quiz.code}`, created.creatorToken);
          setLocation(`/create?code=${encodeURIComponent(created.quiz.code)}`);
          if (publish) {
            setPublishAfterCreate(true);
          } else {
            setNotice('Draft saved. Keep shaping it or publish when it’s ready.');
          }
        },
        onError: () => setNotice('Couldn’t create this draft. Please try again.'),
      });
    }
  };

  if (code && editorQuery.isLoading) return <AppShell><PageLoading label="Opening your draft" /></AppShell>;
  if (code && editorQuery.isError) return <AppShell><ErrorMessage retry={() => editorQuery.refetch()} /></AppShell>;

  return (
    <AppShell>
      <div className="editor-page page-enter">
        <div className="editor-topline">
          <Link href="/" className="back-link" data-testid="link-back-dashboard"><ArrowLeft size={16} /> Studio</Link>
          <span className={classNames('draft-state', locked && 'state-live')}><span />{locked ? 'Competition active · editing locked' : code ? 'Draft in progress' : 'New quiz draft'}</span>
        </div>
        {locked && <div className="locked-banner"><LockKeyhole size={17} /> This quiz is active. Configuration is locked until the competition ends.</div>}
        <div className="editor-heading">
          <div><p className="eyebrow">THE QUIZ BUILDER</p><h1 className="display-font">{code ? 'Make it even' : 'Start with'} <em>curious.</em></h1></div>
          <span className="step-label"><span>01</span> DETAILS <i /> <span>02</span> QUESTIONS <i /> <span>03</span> SHARE</span>
        </div>
        <div className="editor-layout">
          <div className="editor-main">
            <section className="editor-section">
              <div className="editor-section-heading"><span className="section-number">01</span><div><h2>Set the scene</h2><p>Give your quiz a name people remember.</p></div></div>
              <label className="input-label" htmlFor="quiz-title">Quiz title</label>
              <input id="quiz-title" className="text-input title-input" data-testid="input-quiz-title" disabled={locked} value={form.title} onChange={(event) => setField('title', event.target.value)} placeholder="e.g. The very curious food quiz" />
              <label className="input-label" htmlFor="quiz-description">A short intro <span>OPTIONAL</span></label>
              <textarea id="quiz-description" className="text-input text-area" data-testid="input-quiz-description" disabled={locked} value={form.description} onChange={(event) => setField('description', event.target.value)} placeholder="Set the mood. What are players in for?" rows={3} />
            </section>

            <section className="editor-section">
              <div className="editor-section-heading"><span className="section-number">02</span><div><h2>Pick your play style</h2><p>Choose how people will play together.</p></div></div>
              <div className="mode-options">
                <button className={classNames('mode-card', form.mode === 'static' && 'mode-selected')} disabled={locked} onClick={() => { setField('mode', 'static'); }} data-testid="button-mode-static">
                  <span className="mode-icon"><Clock3 size={19} /></span><span><strong>Self-paced</strong><small>Players go at their own speed.</small></span>{form.mode === 'static' && <Check className="mode-check" size={17} />}
                </button>
                <button className={classNames('mode-card', form.mode === 'competition' && 'mode-selected')} disabled={locked} onClick={() => { setField('mode', 'competition'); if (form.timerMode === 'none') setField('timerMode', 'per_question'); }} data-testid="button-mode-competition">
                  <span className="mode-icon mode-icon-coral"><Radio size={19} /></span><span><strong>Live competition</strong><small>Everyone plays at once.</small></span>{form.mode === 'competition' && <Check className="mode-check" size={17} />}
                </button>
              </div>
              <div className="timer-row">
                <label className="input-label" htmlFor="timer-mode">Timer</label>
                <div className="select-wrap"><select id="timer-mode" data-testid="select-timer-mode" disabled={locked} value={form.timerMode} onChange={(event) => setField('timerMode', event.target.value as QuizInput['timerMode'])}>
                  <option value="none" disabled={form.mode === 'competition'}>No timer</option><option value="per_question">Time per question</option><option value="total">Total quiz time</option>
                </select><ChevronDown size={16} /></div>
              </div>
              {form.timerMode === 'total' && <div className="duration-input"><label className="input-label" htmlFor="duration">Total duration <span>MINUTES</span></label><input id="duration" type="number" min="1" className="text-input small-input" disabled={locked} value={form.totalDurationMinutes ?? ''} onChange={(event) => setField('totalDurationMinutes', event.target.value ? Number(event.target.value) : null)} placeholder="12" /></div>}
              {form.mode === 'competition' && <p className="helper-note"><Radio size={14} /> Competition timer is synchronized for every player. Configuration locks when host starts.</p>}
            </section>

            <section className="editor-section">
              <div className="editor-section-heading question-head"><span className="section-number">03</span><div><h2>Write the questions</h2><p>Every question is a chance to surprise someone.</p></div><span className="question-count">{form.questions.length} QUESTIONS</span></div>
              <div className="question-editor-list">
                {form.questions.map((question, index) => (
                  <article className="question-editor" key={question._key}>
                    <div className="question-editor-top"><span className="question-badge">Q{String(index + 1).padStart(2, '0')}</span>{form.timerMode === 'per_question' || form.mode === 'competition' ? <label className="question-time"><Clock3 size={13} /><input aria-label={`Question ${index + 1} time limit in seconds`} type="number" min="1" disabled={locked} value={question.timeLimitSeconds ?? 20} onChange={(event) => updateQuestion(index, { timeLimitSeconds: Number(event.target.value) })} /><span>SEC</span></label> : null}<button className="icon-button remove-question" disabled={locked || form.questions.length <= 1} onClick={() => removeQuestion(index)} aria-label={`Remove question ${index + 1}`}><X size={16} /></button></div>
                    <textarea className="text-input prompt-input" disabled={locked} value={question.prompt} onChange={(event) => updateQuestion(index, { prompt: event.target.value })} placeholder="Write your question here..." rows={2} data-testid={`input-question-${index}`} />
                    <div className="answer-list">
                      {question.options.map((option, optionIndex) => <div className={classNames('answer-input-row', question.correctOption === optionIndex && 'answer-correct')} key={`${question._key}-${optionIndex}`}>
                        <button className="correct-toggle" type="button" title="Mark correct answer" disabled={locked} onClick={() => updateQuestion(index, { correctOption: optionIndex })} aria-label={`Mark answer ${optionIndex + 1} as correct`}>{question.correctOption === optionIndex ? <Check size={14} /> : String.fromCharCode(65 + optionIndex)}</button>
                        <input className="text-input answer-input" disabled={locked} value={option} onChange={(event) => updateOption(index, optionIndex, event.target.value)} placeholder={`Answer option ${String.fromCharCode(65 + optionIndex)}`} data-testid={`input-option-${index}-${optionIndex}`} />
                        {question.correctOption === optionIndex && <span className="correct-label">CORRECT</span>}
                      </div>)}
                    </div>
                    <button className="add-answer" disabled={locked || question.options.length >= 6} onClick={() => updateQuestion(index, { options: [...question.options, ''] })}><Plus size={14} /> Add answer</button>
                  </article>
                ))}
              </div>
              <button className="add-question-button" disabled={locked} onClick={addQuestion} data-testid="button-add-question"><Plus size={17} /> Add another question</button>
            </section>

            <section className="editor-section theme-section">
              <div className="editor-section-heading"><span className="section-number">04</span><div><h2>Choose Your Quiz Theme</h2><p>Set the visual tone for the whole quiz.</p></div></div>
              <div className="theme-grid">
                {themeDetails.map((theme) => <button key={theme.key} className={classNames('theme-choice', form.theme === theme.key && 'theme-selected')} disabled={locked} onClick={() => setField('theme', theme.key)} data-testid={`button-theme-${theme.key}`}>
                  <span className={classNames('theme-swatch', theme.className)}><i /><i /><i /></span><strong>{theme.title}</strong><small>{theme.note}</small>{form.theme === theme.key && <span className="theme-check"><Check size={12} /></span>}
                </button>)}
              </div>
            </section>
            {notice && <div className={notice.includes('saved') ? 'success-notice' : 'validation-notice'} role="status">{notice}</div>}
            <div className="editor-actions">
              <button className="button button-quiet" disabled={busy || locked} onClick={() => save(false)} data-testid="button-save-draft">Save for later</button>
              <button className="button button-primary" disabled={busy || locked} onClick={() => save(true)} data-testid="button-publish-quiz">{busy ? <LoaderCircle className="spin" size={16} /> : <Sparkles size={16} />} Publish quiz <ArrowRight size={16} /></button>
            </div>
          </div>
          <aside className="preview-column">
            <div className="preview-sticky">
              <div className="preview-label"><span><span className="live-dot" /> LIVE PREVIEW</span><span>{themeDetails.find((theme) => theme.key === form.theme)?.title}</span></div>
              <div className={classNames('preview-card', `preview-${form.theme}`)}>
                <QuizArtwork theme={form.theme} />
               <div className="preview-card-content"><span className="preview-tag">{form.mode === 'competition' ? 'LIVE GAME' : 'QUIZ PREVIEW'}</span><h3>{form.title || 'Your quiz title'}</h3><p>{form.description || 'A little preview of what players will see.'}</p><div className="preview-stats"><span><CircleHelp size={14} /> {form.questions.length} questions</span><span><Clock3 size={14} /> {form.timerMode === 'none' ? 'No timer' : form.timerMode === 'total' ? `${form.totalDurationMinutes || '—'} min` : `${form.questions[0]?.timeLimitSeconds || 20}s each`}</span></div>
                 <div className="preview-question">
                   <span>QUESTION 01</span>
                   <strong>{form.questions[0]?.prompt || 'Your first question appears here.'}</strong>
                   {(form.questions[0]?.options ?? ['', '']).slice(0, 2).map((option, index) => (
                     <div className="preview-option" key={index}>
                       <i>{String.fromCharCode(65 + index)}</i>
                       <span>{option || `Answer option ${String.fromCharCode(65 + index)}`}</span>
                     </div>
                   ))}
                 </div>
                  <button className="preview-start" disabled>Let’s play <ArrowRight size={15} /></button>
                </div>
              </div>
              <div className="preview-tip"><Sparkles size={15} /><span><strong>Little tip</strong> Keep your title short and your questions surprising.</span></div>
            </div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

export function QuizPage() {
  const params = useParams<{ code: string }>();
  const code = params.code ?? '';
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [participantName, setParticipantName] = useState('');
  const [joinError, setJoinError] = useState('');
  const [copied, setCopied] = useState(false);
  const quizQuery = useGetQuiz(code, { query: { queryKey: getGetQuizQueryKey(code), refetchInterval: 5000 } });
  const quiz = quizQuery.data;
  const startAttempt = useStartAttempt();
  const startCompetition = useStartCompetition({ request: creatorRequest(code) });
  const stopCompetition = useStopCompetition({ request: creatorRequest(code) });
  const leaderboard = useGetLeaderboard(code, {
    query: { queryKey: getGetLeaderboardQueryKey(code), enabled: quiz?.mode === 'competition' && !!quiz.competitionStartedAt, refetchInterval: 2500 },
  });
  const startGame = () => {
    if (!participantName.trim()) {
      setJoinError('Add your name to join the quiz.');
      return;
    }
    setJoinError('');
    startAttempt.mutate({ code, data: { participantName: participantName.trim() } }, {
      onSuccess: (attempt) => {
        queryClient.setQueryData(getGetAttemptQueryKey(attempt.id), attempt);
        setLocation(`/play/${encodeURIComponent(attempt.id)}`);
      },
      onError: () => setJoinError('Couldn’t join this quiz. It may have ended or the code may be wrong.'),
    });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const stopAndResetCompetition = () => {
    const confirmed = window.confirm(
      'Stop and reset this competition? Players still in progress will be submitted using the answers they have already sent. Scores are kept, and you can then edit the quiz.',
    );
    if (!confirmed) return;
    stopCompetition.mutate(
      { code },
      {
        onSuccess: async () => {
          await quizQuery.refetch();
          await queryClient.invalidateQueries({
            queryKey: getGetLeaderboardQueryKey(code),
          });
        },
        onError: () =>
          setJoinError('Could not stop this competition. Refresh and try again.'),
      },
    );
  };

  if (quizQuery.isLoading) return <AppShell><PageLoading label="Finding your quiz" /></AppShell>;
  if (quizQuery.isError || !quiz) return <AppShell><ErrorMessage retry={() => quizQuery.refetch()} /></AppShell>;
  const active = quiz.mode === 'competition' && !!quiz.competitionStartedAt;

  return (
    <AppShell>
      <div className={classNames('quiz-detail page-enter', `detail-${quiz.theme}`)}>
        <Link href="/" className="back-link" data-testid="link-back-studio"><ArrowLeft size={16} /> Back to studio</Link>
        <div className="quiz-detail-grid">
          <div className="quiz-detail-main">
            <div className="detail-art-hero"><QuizArtwork theme={quiz.theme} /><span className="detail-mode"><span />{formatMode(quiz)}</span></div>
             <div className="detail-title-row"><div><p className="eyebrow">{quiz.mode === 'competition' ? 'GATHER YOUR PLAYERS' : 'A QUIZ TO SHARE'}</p><h1 className="display-font">{quiz.title}</h1><p className="detail-description">{quiz.description || 'A little knowledge, a lot of fun.'}</p></div><div className="detail-title-actions">{tokenFor(code) && <Link href={`/create?code=${encodeURIComponent(code)}`} className="share-button" data-testid="link-edit-quiz"><ExternalLink size={15} /> Edit</Link>}<button className="share-button" onClick={copyLink} data-testid="button-share-quiz">{copied ? <Check size={16} /> : <Share2 size={16} />}{copied ? 'Copied' : 'Share'}</button></div></div>
            <div className="detail-facts"><span><CircleHelp size={16} /> {quiz.questions.length} questions</span><span><Clock3 size={16} /> {quiz.timerMode === 'none' ? 'No timer' : quiz.timerMode === 'total' ? `${quiz.totalDurationMinutes} minutes total` : `${quiz.questions.map((question) => question.timeLimitSeconds ?? 0).join(' / ')} seconds per question`}</span><span><Users size={16} /> {quiz.mode === 'competition' ? 'Play together' : 'Play your way'}</span></div>
            {quiz.mode === 'competition' && <section className="host-card">
              <div className="host-card-heading"><span className="host-live-icon"><Radio size={17} /></span><div><h2>{active ? 'The room is live.' : 'Ready when you are.'}</h2><p>{active ? 'Players can join now. The clock is synchronized.' : 'As host, start the clock when everyone is in the room.'}</p></div></div>
              <div className="host-actions">
                 {active ? <span className="active-status"><span className="live-dot" /> Competition in progress</span> : tokenFor(code) ? <button className="button button-primary" disabled={startCompetition.isPending} onClick={() => startCompetition.mutate({ code }, { onSuccess: () => quizQuery.refetch(), onError: () => setJoinError('Only the quiz creator can start this competition.') })} data-testid="button-start-competition">{startCompetition.isPending ? <LoaderCircle size={16} className="spin" /> : <Radio size={16} />} Start competition</button> : <span className="active-status">Waiting for the host</span>}
                 {active && tokenFor(code) && <button className="button button-quiet host-stop-button" disabled={stopCompetition.isPending} onClick={stopAndResetCompetition} data-testid="button-stop-competition">{stopCompetition.isPending ? <LoaderCircle size={15} className="spin" /> : <X size={15} />} Stop & reset</button>}
                 {tokenFor(code) && <Link href={`/create?code=${encodeURIComponent(code)}`} className="host-edit-link"><ExternalLink size={14} /> Edit quiz</Link>}
              </div>
              {startCompetition.isError && <p className="field-error">Creator access is needed to start this competition.</p>}
              {stopCompetition.isError && <p className="field-error">Could not stop this competition. Refresh and try again.</p>}
              {active && <div className="host-leaderboard"><div className="leaderboard-heading"><Trophy size={15} /> Current standings <span>UPDATING LIVE</span></div>{leaderboard.data?.length ? leaderboard.data.slice(0, 5).map((entry, index) => <div className="leaderboard-row" key={`${entry.participantName}-${index}`}><span className="leader-place">{String(index + 1).padStart(2, '0')}</span><span>{entry.participantName}</span><strong>{entry.score}</strong></div>) : <p className="leaderboard-empty">No players just yet. Share the code and fill the room.</p>}</div>}
            </section>}
          </div>
          <aside className="join-card">
            <span className="join-card-kicker">{active ? 'THE GAME IS ON' : 'YOUR SEAT IS WAITING'}</span>
            <h2>{active ? 'Jump in.' : 'Ready to play?'}</h2>
            <p>{active ? 'Add your name and see how you stack up.' : quiz.mode === 'competition' ? 'Join before the host starts the clock.' : 'No pressure. Just a few good questions.'}</p>
            {quiz.mode === 'competition' && !active ? <div className="waiting-state"><span className="waiting-pulse" /> Waiting for host to start</div> : <>
              <label htmlFor="player-name" className="input-label">Your name</label>
              <input id="player-name" className="text-input" value={participantName} onChange={(event) => setParticipantName(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && startGame()} placeholder="What should we call you?" data-testid="input-participant-name" />
              {joinError && <p className="field-error">{joinError}</p>}
              <button className="button button-primary join-play-button" disabled={startAttempt.isPending || (quiz.mode === 'competition' && !active)} onClick={startGame} data-testid="button-play-quiz">{startAttempt.isPending ? <LoaderCircle size={16} className="spin" /> : <ArrowRight size={16} />} Join the quiz</button>
            </>}
            <div className="join-code"><span>QUIZ CODE</span><strong>{quiz.code}</strong><button aria-label="Copy quiz link" onClick={copyLink} data-testid="button-copy-code">{copied ? <Check size={15} /> : <Copy size={15} />}</button></div>
            <div className="join-card-foot"><Sparkles className="tiny-spark" size={14} /> Made to play together</div>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}

function formatTime(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  const remainder = Math.max(0, seconds) % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

export function PlayPage() {
  const params = useParams<{ attemptId: string }>();
  const attemptId = params.attemptId ?? '';
  const queryClient = useQueryClient();
  const attemptQuery = useGetAttempt(attemptId, {
    query: { queryKey: getGetAttemptQueryKey(attemptId), refetchInterval: 1000, refetchOnWindowFocus: true },
  });
  const submitAnswer = useSubmitAnswer();
  const navigateAttempt = useNavigateAttempt();
  const finishAttempt = useFinishAttempt();
  const attempt = attemptQuery.data;
  const [selected, setSelected] = useState<number | null>(null);
  const [clientNow, setClientNow] = useState(Date.now());
  const [hasBegun, setHasBegun] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setClientNow(Date.now()), 200);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress') return;
    const deadline = attempt.questionDeadline ?? attempt.totalDeadline;
    if (!deadline) return;
    const remaining = deadline - (attempt.serverNow + (clientNow - (attemptQuery.dataUpdatedAt || clientNow)));
    if (remaining <= 0) {
      window.setTimeout(() => attemptQuery.refetch(), 0);
    }
  }, [attempt, clientNow, attemptQuery.dataUpdatedAt]);

  useEffect(() => {
    if (attempt) setSelected(attempt.answers.find((answer) => answer.questionIndex === attempt.currentQuestionIndex)?.selectedOption ?? null);
  }, [attempt?.currentQuestionIndex, attempt?.answers.length]);

  useEffect(() => {
    if (attempt && (attempt.answers.length > 0 || attempt.questionDeadline || attempt.totalDeadline || attempt.quiz.mode === 'competition')) setHasBegun(true);
  }, [attempt?.answers.length, attempt?.questionDeadline, attempt?.totalDeadline, attempt?.quiz.mode]);

  const secondsLeft = useMemo(() => {
    if (!attempt) return 0;
    const deadline = attempt.questionDeadline ?? attempt.totalDeadline;
    if (!deadline) return 0;
    const elapsedClient = Date.now() - (attemptQuery.dataUpdatedAt || Date.now());
    return Math.max(0, Math.ceil((deadline - attempt.serverNow - elapsedClient) / 1000));
  }, [attempt?.questionDeadline, attempt?.totalDeadline, attempt?.serverNow, clientNow]);

  const setCache = (updated: Attempt) => {
    queryClient.setQueryData(getGetAttemptQueryKey(attemptId), updated);
    setSelected(updated.answers.find((answer) => answer.questionIndex === updated.currentQuestionIndex)?.selectedOption ?? null);
  };

  if (attemptQuery.isLoading) return <AppShell><PageLoading label="Getting your game ready" /></AppShell>;
  if (attemptQuery.isError || !attempt) return <AppShell><ErrorMessage retry={() => attemptQuery.refetch()} /></AppShell>;

  const quiz = attempt.quiz;
  const currentIndex = Math.max(0, Math.min(attempt.currentQuestionIndex, quiz.questions.length - 1));
  const question = quiz.questions[currentIndex];
  const submitted = attempt.status === 'submitted';
  const finished = submitted;
  const totalSeconds = secondsLeft;
  const canNavigate =
    !finished &&
    (quiz.timerMode === 'total' ||
      (quiz.mode === 'static' && quiz.timerMode === 'none'));
  const selectedAnswer = attempt.answers.find((answer) => answer.questionIndex === currentIndex)?.selectedOption;
  const answer = (nextQuestion?: number) => {
    if (selected === null || submitAnswer.isPending || finished) return;
    submitAnswer.mutate({ attemptId, data: { questionIndex: currentIndex, selectedOption: selected } }, {
      onSuccess: (updated) => {
        setCache(updated);
        if (nextQuestion !== undefined) {
          navigateAttempt.mutate({ attemptId, data: { questionIndex: nextQuestion } }, { onSuccess: setCache, onError: () => attemptQuery.refetch() });
        } else if (currentIndex === quiz.questions.length - 1) {
          finishAttempt.mutate({ attemptId }, { onSuccess: setCache, onError: () => attemptQuery.refetch() });
        }
      },
      onError: () => attemptQuery.refetch(),
    });
  };
  const move = (index: number) => {
    if (!canNavigate || index < 0 || index >= quiz.questions.length) return;
    navigateAttempt.mutate({ attemptId, data: { questionIndex: index } }, { onSuccess: setCache, onError: () => attemptQuery.refetch() });
  };
  const finish = () => finishAttempt.mutate({ attemptId }, { onSuccess: setCache, onError: () => attemptQuery.refetch() });
  const isIntro = !hasBegun && !finished && attempt.answers.length === 0 && currentIndex === 0 && quiz.mode === 'static' && quiz.timerMode === 'none';

  return (
    <AppShell>
      <div className={classNames('play-page page-enter', `play-${quiz.theme}`)}>
        <div className="play-topline"><Link href={`/quiz/${encodeURIComponent(quiz.code)}`} className="back-link"><ArrowLeft size={16} /> Quiz details</Link><span className="play-theme"><span className="theme-mini-dot" /> {themeDetails.find((theme) => theme.key === quiz.theme)?.title} edition</span></div>
        {isIntro ? <section className="play-intro">
          <QuizArtwork theme={quiz.theme} />
          <div className="play-intro-copy"><p className="eyebrow">YOU’RE IN, {attempt.participantName.toUpperCase()}</p><h1 className="display-font">Ready for<br /><em>{quiz.title}?</em></h1><p>{quiz.description || 'A few questions. A fresh perspective. Let’s see what you know.'}</p><div className="intro-facts"><span><CircleHelp size={15} /> {quiz.questions.length} questions</span><span><Clock3 size={15} /> {quiz.timerMode === 'none' ? 'No timer' : quiz.timerMode === 'total' ? `${quiz.totalDurationMinutes} minutes` : 'Timed questions'}</span></div><button className="button button-primary" onClick={() => setHasBegun(true)} data-testid="button-begin-quiz">I’m ready <ArrowRight size={17} /></button></div>
          <div className="intro-note"><Sparkles size={16} /> Trust your first thought.</div>
        </section> : finished ? <section className="result-layout">
          <div className="result-hero"><span className="result-medal"><Trophy size={24} /></span><p className="eyebrow">THAT’S A WRAP, {attempt.participantName.toUpperCase()}</p><h1 className="display-font">You showed<br /><em>up brilliantly.</em></h1><p>Every answer is a little proof of what you know.</p><div className="score-stamp"><strong>{attempt.score ?? 0}</strong><span>POINTS</span></div></div>
          <div className="result-side"><QuizArtwork theme={quiz.theme} compact /><div className="result-board"><div className="leaderboard-heading"><Trophy size={16} /> {quiz.mode === 'competition' ? 'Competition leaderboard' : 'Your results'}<span>FINAL</span></div>{attempt.leaderboard?.length ? attempt.leaderboard.slice(0, 8).map((entry, index) => <div className={classNames('leaderboard-row', entry.participantName === attempt.participantName && 'leaderboard-you')} key={`${entry.participantName}-${index}`}><span className="leader-place">{index === 0 ? <Crown size={14} /> : String(index + 1).padStart(2, '0')}</span><span>{entry.participantName}{entry.participantName === attempt.participantName ? ' · you' : ''}</span><strong>{entry.score}</strong></div>) : <p className="leaderboard-empty">Your score is ready. Thanks for playing.</p>}</div><Link href="/" className="button button-secondary" data-testid="link-return-home">Back to studio <ArrowRight size={15} /></Link></div>
        </section> : (
          <section className="question-flow">
            <div className="play-progress-line"><span style={{ width: `${((currentIndex + 1) / quiz.questions.length) * 100}%` }} /></div>
            <div className="question-flow-top"><span className="question-step">QUESTION <strong>{String(currentIndex + 1).padStart(2, '0')}</strong> <i>OF</i> {String(quiz.questions.length).padStart(2, '0')}</span>{(attempt.questionDeadline || attempt.totalDeadline) && <span className={classNames('countdown', secondsLeft <= 10 && 'countdown-low')}><Clock3 size={16} /> {formatTime(totalSeconds)}</span>}</div>
            <div className="question-flow-body"><p className="eyebrow">{quiz.mode === 'competition' ? 'THE CLOCK IS LIVE' : 'TAKE YOUR BEST GUESS'}</p><h1 className="display-font">{question?.prompt}</h1><div className="play-options">
              {question?.options.map((option, index) => <button key={`${question.id}-${index}`} className={classNames('play-option', selected === index && 'play-option-selected', selectedAnswer === index && 'play-option-answered')} onClick={() => setSelected(index)} disabled={submitAnswer.isPending} data-testid={`button-answer-${index}`}><span className="option-letter">{String.fromCharCode(65 + index)}</span><span>{option}</span>{selected === index && <Check className="option-check" size={17} />}</button>)}
            </div>
            {submitAnswer.isError && <p className="field-error">That answer didn’t go through. Choose again or try submitting once more.</p>}
            <div className="question-flow-actions">{canNavigate && <button className="button button-quiet" disabled={currentIndex === 0 || navigateAttempt.isPending} onClick={() => move(currentIndex - 1)}><ArrowLeft size={15} /> Previous</button>}
              {canNavigate && currentIndex < quiz.questions.length - 1 ? <button className="button button-primary" disabled={selected === null || navigateAttempt.isPending || submitAnswer.isPending} onClick={() => answer(currentIndex + 1)} data-testid="button-next-question">Next question <ArrowRight size={16} /></button> : <button className="button button-primary" disabled={selected === null || submitAnswer.isPending || secondsLeft === 0} onClick={() => answer()} data-testid="button-submit-answer">{submitAnswer.isPending ? <LoaderCircle size={16} className="spin" /> : null}{currentIndex === quiz.questions.length - 1 ? 'Submit answer' : 'Lock in answer'} <ArrowRight size={16} /></button>}
             {quiz.mode === 'static' && quiz.timerMode !== 'per_question' && currentIndex === quiz.questions.length - 1 && <button className="button button-secondary" onClick={finish} disabled={finishAttempt.isPending}>Finish quiz <Check size={16} /></button>}
            </div>
            {canNavigate && <div className="question-nav">{quiz.questions.map((item, index) => <button className={classNames('question-nav-dot', index === currentIndex && 'question-nav-current', attempt.answers.some((saved) => saved.questionIndex === index) && 'question-nav-answered')} key={item.id} onClick={() => move(index)} aria-label={`Go to question ${index + 1}`} />)}</div>}
          </div>
          </section>
        )}
        <div className="play-footer-note"><Sparkles className="tiny-spark" size={14} /> {quiz.mode === 'competition' ? 'Everyone’s on the same clock.' : 'No peeking. You’ve got this.'}</div>
      </div>
    </AppShell>
  );
}
