let knownGifts = { "rosa": { name: "Rosa", cost: 1 }, "tiktok": { name: "TikTok", cost: 1 }, "sorvete": { name: "Sorvete", cost: 1 }, "pimenta": { name: "Pimenta", cost: 1 }, "coração": { name: "Coração", cost: 10 }, "coroa": { name: "Coroa", cost: 99 }, "leão": { name: "Leão", cost: 29999 } };
try {
    let savedGifts = localStorage.getItem('tiktok_known_gifts');
    if (savedGifts && savedGifts !== "undefined") { knownGifts = JSON.parse(savedGifts); }
} catch(e) {}

function saveKnownGifts() { localStorage.setItem('tiktok_known_gifts', JSON.stringify(knownGifts)); }

let gameSettings = { tapPoints: 0.5, normalPoints: 10, bonusPoints: 50, plusPoints: 100, masterGift: '', rankPtsActive: true, rankPtsTime: 5, rankRoundGiftsActive: true, rankRoundGiftsTime: 7, rankLiveGiftsActive: true, rankLiveGiftsTime: 3.5 };
function loadSettings() {
    try {
        let saved = localStorage.getItem('tiktok_game_settings');
        if (saved && saved !== "undefined") { gameSettings = { ...gameSettings, ...JSON.parse(saved) }; }
    } catch(e) {}
}
loadSettings();

// Aspirador de Texto
function normalizeText(text) {
    if (!text) return "";
    return text.toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

let questionsDB = [];
const fallbackDB = [{ q: "Qual é a capital do Brasil?", a: "Rio de Janeiro", b: "Brasília", c: "São Paulo", d: "Salvador", correct: "b" }];
let players = {}; try { players = JSON.parse(localStorage.getItem('show_players') || '{}'); } catch(e) {}

let currentQIndex = 0; let gameState = 'waiting'; let currentQuestion = null; let qValue = 10; let questionsAskedCounter = 0;
let correctPlayers = {}; let playersAnswered = {}; let roundGifts = {}; let playerSpecialGifts = {}; let someoneAnswered = false;
let timerInterval; let timeLeft = 45; let confettiInterval; let comboUser = ""; let comboCount = 0;
let currentRankPage = 0; let activeRankPages = []; let rankRotationTimeout;
let lastSettingsCache = "";
let lastCmdTs = 0;
let audioInited = false;
let gameActive = false;

// =========================================================================
// 🛡️ SISTEMA DE LICENÇA RDM STUDIO E DETECÇÃO OBS
// =========================================================================
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('u') && urlParams.has('p')) {
    localStorage.setItem('rdm_user', urlParams.get('u'));
    localStorage.setItem('rdm_perfil', urlParams.get('p'));
}

window.rdmUser = localStorage.getItem('rdm_user_tiktok') || localStorage.getItem('rdm_user');
window.rdmPerfil = localStorage.getItem('rdm_perfil');

// Se tiver "&obs=1" no link, ele apaga a tela de bloqueio do Áudio para rodar liso no OBS
const isOBS = urlParams.has('obs');
if (isOBS) {
    document.getElementById('overlay').style.display = 'none';
    gameActive = true; // Inicia o jogo silenciosamente sem áudio narrador
}

if (!window.rdmUser || !window.rdmPerfil) {
    document.body.innerHTML = "<div style='display:flex; flex-direction:column; justify-content:center; align-items:center; height:100vh; background:#000;'><h1 style='color:#ef4444; text-shadow:0 0 20px #ef4444;'>ACESSO NEGADO</h1><p style='color:#ccc; font-size:20px;'>Você precisa estar logado na RDM Studio para jogar.</p></div>";
    window.stop();
}

function iniciarSistema() {
    carregarBancoDePerguntas();

    setInterval(() => {
        let res = localStorage.getItem('tiktok_game_settings');
        if (res && res !== lastSettingsCache && res.trim() !== "") {
            lastSettingsCache = res;
            loadSettings(); updateActiveRankPages(); window.atualizarPontosDaPerguntaAtual();
        }

        // ESCUTA OS CONTROLES REMOTOS DO PAINEL HTML
        let cmdStr = localStorage.getItem('show_command');
        if (cmdStr) {
            let cmd = JSON.parse(cmdStr);
            if (cmd.ts !== lastCmdTs) {
                lastCmdTs = cmd.ts;
                if (cmd.action === 'acao_principal') window.hostAction();
                if (cmd.action === 'zerar_tudo') window.resetRankings();
            }
        }
    }, 1000);

    setInterval(() => {
        if (window.rdmPerfil === "gratuito" || window.rdmPerfil === "plus premium") {
            let horaAtual = Date.now();
            if (!window.rdmSessaoIniciada) window.rdmSessaoIniciada = horaAtual;

            let tempoDecorridoMs = horaAtual - window.rdmSessaoIniciada;
            let limiteMs = (window.rdmPerfil === "gratuito") ? (2 * 60 * 60 * 1000) : (42 * 60 * 60 * 1000);

            if (tempoDecorridoMs >= limiteMs) {
                let blockScreen = document.getElementById('rdm-block-screen');
                if (!blockScreen) {
                    blockScreen = document.createElement('div');
                    blockScreen.id = 'rdm-block-screen';
                    blockScreen.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(0,0,0,0.95); z-index:999999; display:flex; flex-direction:column; justify-content:center; align-items:center;';
                    blockScreen.innerHTML = `<h1 style='color:#facc15; font-size:40px; text-shadow:0 0 20px #facc15;'>⏱️ TEMPO ESGOTADO!</h1><p style='color:white; font-size:20px;'>A carga de horas do seu plano atual chegou ao fim. Faça um upgrade no site RDM Studio.</p>`;
                    document.body.appendChild(blockScreen);
                }
            }
        }
    }, 1000);
}

iniciarSistema();

// =========================================================================
// LÓGICA DO JOGO
// =========================================================================
window.atualizarPontosDaPerguntaAtual = function() {
    if (questionsDB.length > 0 && currentQIndex >= questionsDB.length) { document.getElementById('info-bar').innerHTML = `FIM DE JOGO`; return; }
    if (currentQuestion) {
        let qNumber = currentQIndex + 1;
        if (qNumber % 10 === 0) { qValue = gameSettings.plusPoints; document.getElementById('info-bar').innerHTML = `🌟 PERGUNTA PLUS #${qNumber} | VALE ${qValue} PTS`; }
        else if (qNumber % 4 === 0) { qValue = gameSettings.bonusPoints; document.getElementById('info-bar').innerHTML = `🔥 PERGUNTA BÔNUS #${qNumber} | VALE ${qValue} PTS`; }
        else { qValue = gameSettings.normalPoints; document.getElementById('info-bar').innerHTML = `PERGUNTA #${qNumber} | VALE ${qValue} PTS`; }
    } else if (!currentQuestion && questionsDB.length > 0) {
        let qNumber = currentQIndex + 1; let v = gameSettings.normalPoints;
        if (qNumber % 10 === 0) v = gameSettings.plusPoints; else if (qNumber % 4 === 0) v = gameSettings.bonusPoints;
        document.getElementById('info-bar').innerHTML = `Aguardando Lançamento... (Vale ${v} Pts)`;
    }
};

function liberarHost() {
    document.getElementById('question-box').innerText = "Perguntas carregadas! Host, inicie a partida.";
    document.getElementById('btn-action').disabled = false; document.getElementById('btn-action').style.opacity = 1;
    window.atualizarPontosDaPerguntaAtual();
}

function parsePerguntasSeguro(texto) {
    let jsonLimpo = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
    let parsed = JSON.parse(jsonLimpo);
    if (parsed && !Array.isArray(parsed)) {
        if (Array.isArray(parsed.perguntas)) parsed = parsed.perguntas;
        else if (Array.isArray(parsed.questions)) parsed = parsed.questions;
        else throw new Error("JSON não é um array válido");
    }
    return parsed;
}

function carregarBancoDePerguntas() {
    let customJSON = localStorage.getItem('custom_questions');
    if (customJSON) {
        try { questionsDB = parsePerguntasSeguro(customJSON); liberarHost(); return; } catch(e) { loadFallbackJSON(); }
    } else { loadFallbackJSON(); }
}

function loadFallbackJSON() {
    fetch('questions.json').then(res => { if (!res.ok) throw new Error("JSON não encontrado"); return res.json(); }).then(data => { questionsDB = data; liberarHost(); }).catch(err => { questionsDB = fallbackDB; liberarHost(); });
}

window.aplicarNovasPerguntas = function(parsed) {
    questionsDB = parsed; currentQIndex = 0; questionsAskedCounter = 0; gameState = 'waiting';
    document.getElementById('question-box').innerText = "✅ " + parsed.length + " Novas perguntas recebidas da Nuvem! Inicie a partida.";
    document.getElementById('btn-action').innerText = "Lançar Pergunta"; document.getElementById('btn-action').disabled = false; document.getElementById('btn-action').style.opacity = 1;
    ['a','b','c','d'].forEach(l => { document.getElementById('box-'+l).className = 'alt-box'; document.getElementById('text-'+l).innerText = '...'; });
    document.getElementById('current-leader').innerText = "Aguardando Host...";
    window.atualizarPontosDaPerguntaAtual();
}

const music = document.getElementById('bgMusic'); const sndCorrect = document.getElementById('snd-correct'); const sndWrong = document.getElementById('snd-wrong'); const sndBid = document.getElementById('snd-bid');

function initAudio() {
    if (!audioInited && !isOBS) { // Só inicia áudio se NÃO for OBS
        audioInited = true; music.volume = 0.15; music.play().catch(() => {});
    }
}
function playSFX(audioEl) { if (!isOBS && audioInited && audioEl && gameActive) { const clone = audioEl.cloneNode(); clone.volume = 0.5; clone.play().catch(() => {}); } }

function narrarInteracao(text) {
    if (!window.speechSynthesis || !gameActive || isOBS) return; // Narrador desativado no OBS
    window.speechSynthesis.cancel();
    setTimeout(() => { const msg = new SpeechSynthesisUtterance(text); msg.lang = 'pt-BR'; msg.pitch = 0.9; msg.rate = 1.1; msg.volume = 1.0; window.speechSynthesis.speak(msg); }, 50);
}

document.getElementById('overlay').addEventListener('click', () => {
    document.getElementById('overlay').style.display = 'none'; gameActive = true; initAudio();
    if(window.speechSynthesis && !isOBS) { let msg = new SpeechSynthesisUtterance(""); msg.volume = 0; window.speechSynthesis.speak(msg); setTimeout(() => { narrarInteracao("Bem vindos ao Show! Sistema iniciado."); }, 100); }
});

const sabotageKeywords = ['pimenta', 'chili']; const antiSabotageKeywords = ['sorvete', 'ice cream', 'icecream'];

function updateActiveRankPages() {
    activeRankPages = [];
    if(gameSettings.rankPtsActive) activeRankPages.push({id: 'page-pts', time: gameSettings.rankPtsTime * 1000});
    if(gameSettings.rankRoundGiftsActive) activeRankPages.push({id: 'page-round-gifts', time: gameSettings.rankRoundGiftsTime * 1000});
    if(gameSettings.rankLiveGiftsActive) activeRankPages.push({id: 'page-gifts', time: gameSettings.rankLiveGiftsTime * 1000});
    ['page-pts', 'page-round-gifts', 'page-gifts'].forEach(id => { document.getElementById(id).classList.remove('active-page'); document.getElementById(id).style.display = 'none'; });
    let rankingArea = document.getElementById('ranking-area');
    if(activeRankPages.length > 0) { rankingArea.style.display = 'flex'; if(currentRankPage >= activeRankPages.length) currentRankPage = 0; let currentId = activeRankPages[currentRankPage].id; document.getElementById(currentId).style.display = 'block'; document.getElementById(currentId).classList.add('active-page'); }
    else { rankingArea.style.display = 'none'; }
}
updateActiveRankPages();

function rotateRankPages() {
    clearTimeout(rankRotationTimeout);
    if(gameActive && gameState !== 'podium' && gameState !== 'final_podium' && activeRankPages.length > 0) {
        if (activeRankPages.length > 1) {
            activeRankPages.forEach(p => { document.getElementById(p.id).classList.remove('active-page'); document.getElementById(p.id).style.display = 'none'; });
            currentRankPage = (currentRankPage + 1) % activeRankPages.length;
            let currentId = activeRankPages[currentRankPage].id; document.getElementById(currentId).style.display = 'block'; document.getElementById(currentId).classList.add('active-page');
        }
    }
    let nextTime = activeRankPages.length > 0 ? activeRankPages[currentRankPage].time : 5000; rankRotationTimeout = setTimeout(rotateRankPages, nextTime);
}
rotateRankPages();

function spawnTapEffect(avatarUrl, isShare = false) {
    let el = document.createElement('div'); el.className = 'tap-particle'; if (isShare) el.classList.add('share-particle');
    let textInfo = isShare ? '+50 SHARE!' : `+${gameSettings.tapPoints}`;
    if(avatarUrl) { el.innerHTML = `<img src="${avatarUrl}" style="width:20px; height:20px; border-radius:50%; vertical-align:middle;"> <span style="font-size:12px">${textInfo}</span>`; }
    else { el.innerHTML = `❤️ <span style="font-size:12px">${textInfo}</span>`; }
    let isLeft = Math.random() > 0.5; let x = isLeft ? (Math.random() * 15) : (85 + Math.random() * 10); let y = 50 + Math.random() * 40; el.style.left = x + 'vw'; el.style.top = y + 'vh'; document.body.appendChild(el); setTimeout(() => el.remove(), 2500);
}
function spawnConfetti() {
    for(let i=0; i<80; i++){ let c = document.createElement('div'); c.className = 'confetti'; c.style.left = Math.random() * 100 + 'vw'; c.style.backgroundColor = `hsl(${Math.random()*360}, 100%, 50%)`; c.style.animationDuration = (Math.random() * 2 + 2) + 's'; document.body.appendChild(c); setTimeout(()=>c.remove(), 4000); }
}
function triggerSabotage(nomeTroll) { let qbox = document.getElementById('question-box'); if (!qbox.classList.contains('sabotage-blur')) { qbox.classList.add('sabotage-blur'); narrarInteracao(`Atenção! ${nomeTroll} enviou uma pimenta e embaçou a tela!`); } }
function clearSabotage(nomeHeroi) { let qbox = document.getElementById('question-box'); if (qbox.classList.contains('sabotage-blur')) { qbox.classList.remove('sabotage-blur'); narrarInteracao(`Boa! ${nomeHeroi} enviou um sorvete e limpou a tela!`); } }

function startTimer() {
    clearInterval(timerInterval); timeLeft = 45;
    let bar = document.getElementById('timer-bar'); bar.style.transition = 'none'; bar.style.width = '100%'; bar.style.backgroundColor = '#0f0';
    setTimeout(() => { bar.style.transition = 'width 1s linear, background-color 0.5s'; }, 50);
    timerInterval = setInterval(() => {
        if(gameState !== 'active') { clearInterval(timerInterval); return; }
        timeLeft--; let perc = (timeLeft / 45) * 100; bar.style.width = perc + '%';
        if(timeLeft <= 10) bar.style.backgroundColor = '#f00';
        if(timeLeft <= 0) clearInterval(timerInterval);
    }, 1000);
}

function checkLeaderUI() {
    let correctIds = Object.keys(correctPlayers); if (correctIds.length === 0) return;
    let currentLeaderId = correctIds.sort((a, b) => {
        let specialA = playerSpecialGifts[a] || 0; let specialB = playerSpecialGifts[b] || 0;
        if (specialA !== specialB) return specialB - specialA;
        let bidA = roundGifts[a] || 0; let bidB = roundGifts[b] || 0;
        if (bidA !== bidB) return bidB - bidA;
        return correctPlayers[a] - correctPlayers[b];
    })[0];
    let leaderSpecial = playerSpecialGifts[currentLeaderId] || 0; let leaderBid = roundGifts[currentLeaderId] || 0;

    // Mostra o nome do Master Gift corretamente formatado se tiver
    let nomeMaster = gameSettings.masterGift ? gameSettings.masterGift.toUpperCase() : "PRESENTE MASTER";

    if (leaderSpecial > 0) { document.getElementById('current-leader').innerHTML = `🌟 Liderando: <b style="color:#0ff">${currentLeaderId}</b> (${nomeMaster}!)`; }
    else if (leaderBid > 0) { document.getElementById('current-leader').innerHTML = `🔥 Liderando: <b style="color:#d4af37">${currentLeaderId}</b> (${leaderBid} moedas)`; }
    else { document.getElementById('current-leader').innerHTML = `📝 Liderando: <b style="color:#0f0">${currentLeaderId}</b> (No Chat)`; }
}

window.hostAction = function() {
    const btn = document.getElementById('btn-action');
    if(!questionsDB || questionsDB.length === 0) { alert("⚠️ Aviso: Nenhuma pergunta salva! Clique na engrenagem ⚙️ e adicione as perguntas primeiro."); return; }
    if (gameState === 'waiting' || gameState === 'revealed') { iniciarPergunta(); btn.innerText = "Encerrar e Revelar"; }
    else if (gameState === 'active') { revelarVencedor(); }
    else if (gameState === 'ready_for_podium') { exibirPodio(); btn.innerText = "Continuar Jogo"; }
    else if (gameState === 'podium') { esconderPodio(); iniciarPergunta(); btn.innerText = "Encerrar e Revelar"; }
    else if (gameState === 'ready_for_final_podium') { exibirPodioFinal(); btn.innerText = "Fim de Jogo"; }
}

window.resetRankings = function() {
    if (confirm("Zerar todos os rankings e reiniciar o jogo?")) {
        players = {}; try { localStorage.removeItem('show_players'); } catch(e){}
        roundGifts = {}; playerSpecialGifts = {}; correctPlayers = {}; playersAnswered = {}; comboUser = ""; comboCount = 0; questionsAskedCounter = 0; currentQIndex = 0;
        document.getElementById('podium-screen').style.display = 'none'; clearInterval(confettiInterval);
        gameState = 'waiting'; document.getElementById('btn-action').innerText = "Lançar Pergunta";
        syncRankings(); narrarInteracao("O jogo foi reiniciado e as perguntas voltaram para o começo."); document.getElementById('current-leader').innerText = "Aguardando perguntas...";
        window.atualizarPontosDaPerguntaAtual();
    }
}

function iniciarPergunta() {
    try {
        if (currentQIndex >= questionsDB.length) { alert("Todas as perguntas já foram feitas! Use o botão 'Zerar Tudo'."); return; }
        document.getElementById('round-winner-screen').classList.remove('show'); document.getElementById('question-box').classList.remove('sabotage-blur');
        currentQuestion = questionsDB[currentQIndex];

        if(!currentQuestion || !currentQuestion.q) { throw new Error("Pergunta não identificada."); }

        window.atualizarPontosDaPerguntaAtual();
        document.getElementById('question-box').innerText = currentQuestion.q; document.getElementById('text-a').innerText = currentQuestion.a || "..."; document.getElementById('text-b').innerText = currentQuestion.b || "..."; document.getElementById('text-c').innerText = currentQuestion.c || "..."; document.getElementById('text-d').innerText = currentQuestion.d || "...";
        ['a','b','c','d'].forEach(l => document.getElementById('box-'+l).className = 'alt-box');
        document.getElementById('current-leader').innerText = "Aguardando respostas no chat...";
        correctPlayers = {}; playersAnswered = {}; roundGifts = {}; playerSpecialGifts = {}; someoneAnswered = false; gameState = 'active'; startTimer();
        setTimeout(() => { let textoDeFala = `${currentQuestion.q} ... ${currentQuestion.a}. ... ${currentQuestion.b}. ... ${currentQuestion.c}. ... ${currentQuestion.d}. ... Escreva a resposta no chat e envie presentes para furar a fila! Valendo!`; narrarInteracao(textoDeFala); }, 3500);
    } catch(e) {
        alert("Erro! O Chat GPT mandou uma pergunta corrompida. Pulando para a próxima...");
        currentQIndex++; window.hostAction();
    }
}

function revelarVencedor() {
    clearInterval(timerInterval); document.getElementById('question-box').classList.remove('sabotage-blur');
    ['a','b','c','d'].forEach(l => { let box = document.getElementById('box-'+l); if (l === currentQuestion.correct) box.classList.add('correct'); else box.classList.add('wrong'); });

    let vencedorId = null; let nomeAlternativaCorreta = currentQuestion[currentQuestion.correct]; let correctIds = Object.keys(correctPlayers);
    let rwScreen = document.getElementById('round-winner-screen'); let rwAvatar = document.getElementById('rw-avatar'); let rwTitle = document.getElementById('rw-title'); let rwName = document.getElementById('rw-name'); let rwMethod = document.getElementById('rw-method');

    if (correctIds.length > 0) {
        vencedorId = correctIds.sort((a, b) => { let specialA = playerSpecialGifts[a] || 0; let specialB = playerSpecialGifts[b] || 0; if (specialA !== specialB) return specialB - specialA; let bidA = roundGifts[a] || 0; let bidB = roundGifts[b] || 0; if (bidA !== bidB) return bidB - bidA; return correctPlayers[a] - correctPlayers[b]; })[0];
        let specialVencedor = playerSpecialGifts[vencedorId] || 0; let moedasVencedor = roundGifts[vencedorId] || 0;
        if(!players[vencedorId]) players[vencedorId] = { pts:0, roundPts:0, taps:0, gifts:0, shares:0, avatar: '', correctCount: 0 };
        players[vencedorId].pts += qValue; players[vencedorId].roundPts = (players[vencedorId].roundPts || 0) + qValue; players[vencedorId].correctCount = (players[vencedorId].correctCount || 0) + 1;
        rwAvatar.src = players[vencedorId].avatar || 'data:image/svg+xml;utf8,<svg xmlns=\\\'http://www.w3.org/2000/svg\\\' viewBox=\\\'0 0 100 100\\\'><circle cx=\\\'50\\\' cy=\\\'50\\\' r=\\\'50\\\' fill=\\\'#555\\\'/><text x=\\\'50\\\' y=\\\'65\\\' font-size=\\\'50\\\' text-anchor=\\\'middle\\\' fill=\\\'#fff\\\'>👤</text></svg>';
        rwName.innerText = vencedorId;

        let nomeMaster = gameSettings.masterGift ? gameSettings.masterGift.toUpperCase() : "PRESENTE MASTER";

        if (specialVencedor > 0) { rwMethod.innerHTML = `🌟 Roubou a cena com o PRESENTE MASTER: <b style="color:#0ff">${nomeMaster}</b>!`; narrarInteracao(`A resposta era ${nomeAlternativaCorreta}. ${vencedorId} enviou o Presente Master e garantiu a vitória absoluta!`); }
        else if (moedasVencedor > 0) { rwMethod.innerText = `🔥 Furou a fila com ${moedasVencedor} Moedas!`; narrarInteracao(`A resposta era ${nomeAlternativaCorreta}. ${vencedorId} garantiu a prioridade enviando presentes e levou os pontos!`); }
        else { rwMethod.innerText = `⚡ Mais rápido no Chat!`; narrarInteracao(`A resposta era ${nomeAlternativaCorreta}. Ninguém enviou moedas, então ${vencedorId} que foi o mais rápido no chat levou os pontos!`); }

        if(vencedorId === comboUser) { comboCount++; if(comboCount >= 2) { rwTitle.innerHTML = `<span class="fire-text">🔥 ${comboCount} ACERTOS SEGUIDOS! 🔥<br><span style="font-size:20px; color:#fff">+${qValue} PTS</span></span>`; setTimeout(() => narrarInteracao(`${vencedorId} está incontrolável! ${comboCount} acertos seguidos!`), 4000); } else { rwTitle.innerHTML = `CERTA RESPOSTA!<br><span style="font-size:20px; color:#fff">+${qValue} PTS</span>`; } }
        else { comboUser = vencedorId; comboCount = 1; rwTitle.innerHTML = `CERTA RESPOSTA!<br><span style="font-size:20px; color:#fff">+${qValue} PTS</span>`; }
        rwTitle.classList.remove('rw-lost'); playSFX(sndCorrect); spawnConfetti();

    } else {
        playSFX(sndWrong); comboUser = ""; comboCount = 0; rwAvatar.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%23f55"/><text x="50" y="65" font-size="50" text-anchor="middle" fill="%23fff">❌</text></svg>';
        rwTitle.innerHTML = "TEMPO ESGOTADO"; rwTitle.classList.add('rw-lost'); rwName.innerText = "NINGUÉM ACERTOU"; rwMethod.innerText = `A resposta era: ${nomeAlternativaCorreta}`; narrarInteracao(`Ninguém acertou. A resposta correta era ${nomeAlternativaCorreta}.`);
    }

    rwScreen.classList.add('show'); syncRankings(); questionsAskedCounter++; currentQIndex++; let btn = document.getElementById('btn-action');
    if (currentQIndex >= questionsDB.length) { gameState = 'ready_for_final_podium'; btn.innerText = "Mostrar Pódio Final"; }
    else if (questionsAskedCounter > 0 && questionsAskedCounter % 10 === 0) { gameState = 'ready_for_podium'; btn.innerText = "Mostrar Pódio"; }
    else { gameState = 'revealed'; btn.innerText = "Próxima Pergunta"; }
}

function exibirPodio() {
    gameState = 'podium'; document.getElementById('round-winner-screen').classList.remove('show');
    let arr = Object.keys(players).map(id => ({ name: id, ...players[id] })).sort((a,b) => (b.roundPts || 0) - (a.roundPts || 0));
    [1, 2, 3].forEach(pos => { let el = document.getElementById(`podium-${pos}`); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = null; });
    const fillPodium = (pos, user) => { let pDiv = document.getElementById(`podium-${pos}`); if (user && (user.roundPts || 0) > 0) { pDiv.querySelector('.podium-avatar').src = user.avatar || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='; pDiv.querySelector('.podium-name').innerText = user.name; pDiv.querySelector('.podium-pts').innerText = Math.floor(user.roundPts || 0) + ' pts'; } else { pDiv.querySelector('.podium-avatar').src = ''; pDiv.querySelector('.podium-name').innerText = '...'; pDiv.querySelector('.podium-pts').innerText = '0 pts'; } };
    fillPodium(1, arr[0]); fillPodium(2, arr[1]); fillPodium(3, arr[2]);
    document.getElementById('podium-screen').style.display = 'flex'; document.getElementById('podium-title').innerHTML = `🏆 PÓDIO DAS 10 PERGUNTAS 🏆`;
    narrarInteracao(`Chegamos ao final de mais uma etapa! Vamos ver quem se deu melhor nas últimas dez perguntas!`); playSFX(sndCorrect); spawnConfetti(); confettiInterval = setInterval(spawnConfetti, 4500);
}

function exibirPodioFinal() {
    gameState = 'final_podium'; document.getElementById('round-winner-screen').classList.remove('show');
    let arr = Object.keys(players).map(id => ({ name: id, ...players[id] })).sort((a,b) => { let cA = a.correctCount || 0; let cB = b.correctCount || 0; if (cA !== cB) return cB - cA; return b.pts - a.pts; });
    [1, 2, 3].forEach(pos => { let el = document.getElementById(`podium-${pos}`); el.style.animation = 'none'; void el.offsetWidth; el.style.animation = null; });
    const fillPodium = (pos, user) => { let pDiv = document.getElementById(`podium-${pos}`); if (user && (user.correctCount || 0) > 0) { pDiv.querySelector('.podium-avatar').src = user.avatar || 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='; pDiv.querySelector('.podium-name').innerText = user.name; pDiv.querySelector('.podium-pts').innerText = (user.correctCount || 0) + ' Acertos'; } else { pDiv.querySelector('.podium-avatar').src = ''; pDiv.querySelector('.podium-name').innerText = '...'; pDiv.querySelector('.podium-pts').innerText = '0 Acertos'; } };
    fillPodium(1, arr[0]); fillPodium(2, arr[1]); fillPodium(3, arr[2]);
    document.getElementById('podium-screen').style.display = 'flex'; document.getElementById('podium-title').innerHTML = `🏆 PÓDIO FINAL DA LIVE 🏆<br><span style="font-size:30px; color:#fff; text-shadow: 0 0 15px #fff; display:block; margin-top: 15px;">OBRIGADO POR ASSISTIR A LIVE!</span>`;
    narrarInteracao(`Fim de jogo! Muito obrigado por assistirem a live! Aqui estão os mestres que mais acertaram perguntas hoje!`); playSFX(sndCorrect); spawnConfetti(); confettiInterval = setInterval(spawnConfetti, 4500);
}

function esconderPodio() { document.getElementById('podium-screen').style.display = 'none'; clearInterval(confettiInterval); for(let id in players) { players[id].roundPts = 0; } }

function syncRankings() {
    if (!gameActive) return; try { localStorage.setItem('show_players', JSON.stringify(players)); } catch(e){}
    let arr = Object.keys(players).map(id => ({ name: id, ...players[id] }));
    let tPts = [...arr].sort((a,b) => b.pts - a.pts).slice(0, 10);
    document.getElementById('ranking-pts-list').innerHTML = tPts.map((u, i) => `<div class="rank-item"><span class="rank-pos">#${i+1}</span>${u.avatar ? `<img src="${u.avatar}" class="rank-avatar">` : '👤'}<span class="rank-name">${u.name}</span><span class="rank-pts">${Math.floor(u.pts)}</span></div>`).join('');
    let tRoundGifts = Object.keys(roundGifts).map(id => ({ name: id, gifts: roundGifts[id], avatar: players[id]?.avatar })).sort((a,b) => b.gifts - a.gifts).slice(0, 10);
    document.getElementById('ranking-round-gifts-list').innerHTML = tRoundGifts.map((u, i) => `<div class="rank-item"><span class="rank-pos">#${i+1}</span>${u.avatar ? `<img src="${u.avatar}" class="rank-avatar">` : '👤'}<span class="rank-name">${u.name}</span><span class="rank-gifts">${u.gifts}</span></div>`).join('');
    let tGifts = [...arr].sort((a,b) => b.gifts - a.gifts).slice(0, 10);
    document.getElementById('ranking-gifts-list').innerHTML = tGifts.map((u, i) => `<div class="rank-item"><span class="rank-pos">#${i+1}</span>${u.avatar ? `<img src="${u.avatar}" class="rank-avatar">` : '👤'}<span class="rank-name">${u.name}</span><span class="rank-gifts">${u.gifts}</span></div>`).join('');
}
setInterval(syncRankings, 2000);

function getLightAvatar(url) { if(!url) return ''; return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=40&h=40&fit=cover`; }

// =========================================================================
// PROCESSADOR CENTRAL DE EVENTOS
// =========================================================================
function processarEventoDaAPI(msg) {
    initAudio();
    if (!msg.data || !msg.data.uniqueId || !gameActive) return;

    let id = msg.data.uniqueId;
    let avatar = getLightAvatar(msg.data.profilePictureUrl || msg.data.profilePicUrl);
    if(!players[id]) players[id] = { pts:0, roundPts:0, taps:0, gifts:0, shares:0, avatar: avatar, correctCount: 0 };
    else if(avatar) players[id].avatar = avatar;

    if (msg.event === "like") {
        let qtdLikes = msg.data.likeCount || 1; players[id].taps += qtdLikes; players[id].pts += (qtdLikes * gameSettings.tapPoints);
        let spawns = Math.min(5, Math.ceil(qtdLikes / 10)); for(let i=0; i<spawns; i++) { setTimeout(() => spawnTapEffect(players[id].avatar, false), i*200); }
    }

    if (msg.event === "share") { players[id].shares += 1; players[id].pts += 50; playSFX(sndBid); spawnTapEffect(players[id].avatar, true); }

    if (msg.event === "chat" && gameState === 'active') {
        let comment = msg.data.comment;
        if (comment && !playersAnswered[id]) {
            let txtUsuario = normalizeText(comment); let isAlternative = false; let isCorrect = false;
            ['a', 'b', 'c', 'd'].forEach(l => {
                let txtAlt = normalizeText(currentQuestion[l]);
                if (txtUsuario === txtAlt) {
                    isAlternative = true;
                    if (l === currentQuestion.correct) isCorrect = true;
                }
            });

            if (isAlternative) {
                playersAnswered[id] = true;
                if (isCorrect) {
                    if (!correctPlayers[id]) {
                        correctPlayers[id] = Date.now();
                        if (!someoneAnswered) { someoneAnswered = true; document.getElementById('current-leader').innerHTML = `🔥 <b style="color:#d4af37">Alguém acertou!</b> Envie Mimos para pegar a prioridade!`; playSFX(sndBid); }
                        checkLeaderUI();
                    }
                }
            }
        }
    }

    if (msg.event === "gift") {
        let diamantes = msg.data.diamondCount || 1;

        // Limpa o nome do presente recebido para ficar padrão
        let nomeDoPresente = normalizeText(msg.data.giftName);

        players[id].gifts += diamantes;
        if (!knownGifts[nomeDoPresente]) { knownGifts[nomeDoPresente] = { name: msg.data.giftName, cost: diamantes }; saveKnownGifts(); }

        if(gameState === 'active') {
            roundGifts[id] = (roundGifts[id] || 0) + diamantes;

            let isSabotage = sabotageKeywords.some(k => nomeDoPresente.includes(k));
            let isAntiSabotage = antiSabotageKeywords.some(k => nomeDoPresente.includes(k));

            if(isSabotage) triggerSabotage(id);
            if(isAntiSabotage) clearSabotage(id);

            // Lógica do Presente Master aplicando o Aspirador!
            let masterGiftLimpo = gameSettings.masterGift ? normalizeText(gameSettings.masterGift) : '';
            if (masterGiftLimpo !== '' && nomeDoPresente.includes(masterGiftLimpo)) {
                playerSpecialGifts[id] = (playerSpecialGifts[id] || 0) + diamantes;
            }

            if (correctPlayers[id]) { checkLeaderUI(); playSFX(sndBid); }
        }
    }
}

// =========================================================================
// 📡 ANTENA HÍBRIDA INTELIGENTE (PRIORIDADE TIKFINITY LOCAL)
// =========================================================================
let conexaoNuvemEstabelecida = false;
let wsNuvem = null;
let wsTikfinity = null;
let lastTiktokUser = "";

// Despertador da API (Acorda o servidor Render)
fetch("https://torre-de-controle-rdm.onrender.com/", { mode: 'no-cors' }).catch(() => {});

function conectarNuvem() {
    let targetUser = window.rdmUser;
    if (!targetUser) return;

    if (conexaoNuvemEstabelecida && lastTiktokUser === targetUser) return;
    if (wsNuvem && wsNuvem.readyState === WebSocket.CONNECTING) return;

    if (wsNuvem) wsNuvem.close();

    lastTiktokUser = targetUser;
    console.log(`☁️ Tentando Nuvem para: @${targetUser}...`);

    wsNuvem = new WebSocket("wss://torre-de-controle-rdm.onrender.com:443/");

    wsNuvem.onopen = () => {
        conexaoNuvemEstabelecida = true;
        console.log(`✅ NUVEM CONECTADA! Escutando: @${targetUser}`);
        wsNuvem.send(JSON.stringify({ action: "connect", tiktok_user: targetUser }));
    };

    wsNuvem.onmessage = (event) => {
        try { processarEventoDaAPI(JSON.parse(event.data)); } catch(e) {}
    };

    wsNuvem.onclose = () => { conexaoNuvemEstabelecida = false; wsNuvem = null; };
}

function verificarEConectar() {
    if (!wsTikfinity || wsTikfinity.readyState === WebSocket.CLOSED) {
        wsTikfinity = new WebSocket("ws://127.0.0.1:21213/");

        wsTikfinity.onopen = () => {
            console.log("✅ TikFinity Local Conectado!");
            if (wsNuvem) { wsNuvem.close(); wsNuvem = null; conexaoNuvemEstabelecida = false; }
        };

        wsTikfinity.onmessage = (event) => {
            try { processarEventoDaAPI(JSON.parse(event.data)); } catch(e) {}
        };

        wsTikfinity.onerror = () => { conectarNuvem(); };
        wsTikfinity.onclose = () => { wsTikfinity = null; };
    } else if (wsTikfinity.readyState === WebSocket.OPEN) {
        if (wsNuvem) { wsNuvem.close(); wsNuvem = null; conexaoNuvemEstabelecida = false; }
    }
}

// Inicia o motor de conexão dupla
setInterval(verificarEConectar, 2000);
verificarEConectar();

// Botões de Teclado (Testes)
document.addEventListener('keydown', function(e) {
    initAudio(); const key = e.key.toLowerCase(); if(!gameActive) return;
    let testId = key === 'q' ? 'Maria' : key === 'w' ? 'Joao' : 'Carlos';
    if(!players[testId]) players[testId] = { pts:0, roundPts:0, taps:0, gifts:0, shares:0, avatar: '', correctCount: 0 };

    if (key === 'a' || key === 's' || key === 'd') {
        let tapId = key === 'a' ? 'Maria' : key === 's' ? 'Joao' : 'Carlos';
        if(!players[tapId]) players[tapId] = { pts:0, roundPts:0, taps:0, gifts:0, shares:0, avatar: '', correctCount: 0 };
        players[tapId].taps += 50; players[tapId].pts += (50 * gameSettings.tapPoints); spawnTapEffect(null, false);
    }

    if (key === 'f') { players[testId].shares += 1; players[testId].pts += 50; playSFX(sndBid); spawnTapEffect(null, true); }
    if (key === 't' && gameState === 'active') triggerSabotage('Troll_Anonimo');
    if (key === 'y' && gameState === 'active') clearSabotage('Heroi_da_Live');

    if (key === 'c' && gameState === 'active') {
        let pId = "Comentarista_Simulado";
        if (!playersAnswered[pId]) {
            playersAnswered[pId] = true; correctPlayers[pId] = Date.now();
            if (!someoneAnswered) { someoneAnswered = true; document.getElementById('current-leader').innerHTML = `🔥 <b style="color:#d4af37">Alguém acertou!</b> Envie Mimos para pegar a prioridade!`; playSFX(sndBid); }
            checkLeaderUI();
        }
    }

    if (gameState === 'active' && (key === 'q' || key === 'w' || key === 'e')) {
        let moedasSimuladas = key === 'e' ? 5 : 1; players[testId].gifts += moedasSimuladas; roundGifts[testId] = (roundGifts[testId] || 0) + moedasSimuladas;
        if (key === 'e' && gameSettings.masterGift.trim() !== '') { playerSpecialGifts[testId] = (playerSpecialGifts[testId] || 0) + moedasSimuladas; }
        if (!correctPlayers[testId]) correctPlayers[testId] = Date.now();
        if (!someoneAnswered) { someoneAnswered = true; playSFX(sndBid); }
        checkLeaderUI();
    }
});