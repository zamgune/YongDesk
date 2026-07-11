import Foundation
import SwiftUI
import WebKit

struct InteractiveChartOptions {
    let showMA5: Bool
    let showMA20: Bool
    let showMA60: Bool
    let showRSI: Bool
    let resetToken: Int
    let reloadToken: Int
}

struct InteractiveChartView: NSViewRepresentable {
    let analysis: MarketAnalysisSnapshot?
    let options: InteractiveChartOptions
    @Binding var selectedSignalText: String?
    @Binding var chartError: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(selectedSignalText: $selectedSignalText, chartError: $chartError)
    }

    func makeNSView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "chartStatus")
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = contentController
        configuration.preferences.isElementFullscreenEnabled = false
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        context.coordinator.webView = webView
        context.coordinator.loadChartPage()
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.update(analysis: analysis, options: options)
    }

    static func dismantleNSView(_ nsView: WKWebView, coordinator: Coordinator) {
        nsView.configuration.userContentController.removeScriptMessageHandler(forName: "chartStatus")
        nsView.navigationDelegate = nil
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        weak var webView: WKWebView?
        private var pendingPayload = "{}"
        private var isReady = false
        private var reloadToken = -1
        private var selectedSignalText: Binding<String?>
        private var chartError: Binding<String?>

        init(selectedSignalText: Binding<String?>, chartError: Binding<String?>) {
            self.selectedSignalText = selectedSignalText
            self.chartError = chartError
        }

        func loadChartPage() {
            guard let webView else { return }
            isReady = false
            chartError.wrappedValue = nil
            let baseURL = Bundle.main.resourceURL ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
            webView.loadHTMLString(InteractiveChartPage.html, baseURL: baseURL)
        }

        func update(analysis: MarketAnalysisSnapshot?, options: InteractiveChartOptions) {
            pendingPayload = chartPayload(analysis: analysis, options: options)
            if reloadToken != options.reloadToken {
                reloadToken = options.reloadToken
                loadChartPage()
                return
            }
            renderIfReady()
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            renderIfReady()
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "chartStatus", let body = message.body as? [String: Any] else { return }
            let type = body["type"] as? String
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                switch type {
                case "ready":
                    self.isReady = true
                    self.chartError.wrappedValue = nil
                    self.renderIfReady()
                case "signal":
                    self.selectedSignalText.wrappedValue = body["text"] as? String
                case "error":
                    self.chartError.wrappedValue = body["message"] as? String ?? "차트 엔진을 시작하지 못했습니다."
                default:
                    break
                }
            }
        }

        private func renderIfReady() {
            guard isReady, let webView else { return }
            webView.evaluateJavaScript("window.renderChart(\(pendingPayload));") { [weak self] _, error in
                if let error {
                    DispatchQueue.main.async {
                        self?.chartError.wrappedValue = "차트 데이터를 표시하지 못했습니다: \(error.localizedDescription)"
                    }
                }
            }
        }

        private func chartPayload(analysis: MarketAnalysisSnapshot?, options: InteractiveChartOptions) -> String {
            let candles = analysis?.candles.map { candle in
                ["time": candle.time, "open": candle.open, "high": candle.high, "low": candle.low, "close": candle.close, "volume": candle.volume] as [String: Any]
            } ?? []
            let series = analysis.map { snapshot in
                [
                    "ma5": snapshot.indicators.sma5.map { ["time": $0.time, "value": $0.value] },
                    "ma20": snapshot.indicators.sma20.map { ["time": $0.time, "value": $0.value] },
                    "ma60": snapshot.indicators.sma60.map { ["time": $0.time, "value": $0.value] },
                    "rsi": snapshot.indicators.rsi.map { ["time": $0.time, "value": $0.value] },
                ] as [String: Any]
            } ?? [:]
            var signals = analysis?.recentSignals.map { signal in
                [
                    "time": signal.time,
                    "type": signal.type,
                    "label": signal.label,
                    "reason": signal.reason,
                    "price": signal.price ?? NSNull(),
                ] as [String: Any]
            } ?? []
            if let analysis,
               let breakoutTime = analysis.breakoutTime,
               let breakoutPrice = analysis.breakoutPrice,
               analysis.breakoutStatus != nil,
               analysis.breakoutStatus != "none" {
                signals.append([
                    "time": breakoutTime,
                    "type": "breakout",
                    "label": "돌파",
                    "reason": analysis.breakoutPattern.map { "\($0) · \(analysis.breakoutStatus ?? "")" } ?? "돌파 상태",
                    "price": breakoutPrice,
                ])
            }
            let payload: [String: Any] = [
                "candles": candles,
                "series": series,
                "signals": signals,
                "options": [
                    "showMA5": options.showMA5,
                    "showMA20": options.showMA20,
                    "showMA60": options.showMA60,
                    "showRSI": options.showRSI,
                    "resetToken": options.resetToken,
                ],
            ]
            guard let data = try? JSONSerialization.data(withJSONObject: payload),
                  let text = String(data: data, encoding: .utf8) else {
                return "{}"
            }
            return text
        }
    }
}

private enum InteractiveChartPage {
    static let html = #"""
    <!doctype html><html><head><meta charset="utf-8"><style>
    html,body,#root{margin:0;width:100%;height:100%;background:#101820;color:#dce7ed;font-family:-apple-system,BlinkMacSystemFont,sans-serif;overflow:hidden}
    #root{display:grid;grid-template-rows:minmax(0,1fr) 112px;gap:1px;background:#26343d}.pane{position:relative;min-height:0;background:#101820}.hidden{display:none!important}.watermark{position:absolute;left:12px;top:10px;color:#83929d;font-size:11px;pointer-events:none;z-index:2}.hint{position:absolute;right:10px;top:10px;color:#83929d;font-size:10px;pointer-events:none;z-index:2}
    </style></head><body><div id="root"><div id="pricePane" class="pane"><span class="watermark">가격 · 거래량</span><span class="hint">드래그 이동 · 휠 확대 · 더블클릭 초기화</span></div><div id="rsiPane" class="pane"><span class="watermark">RSI 14</span></div></div>
    <script src="sidecar/node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js"></script>
    <script>
    (()=>{const post=(type,payload={})=>window.webkit?.messageHandlers?.chartStatus?.postMessage({type,...payload});const fail=error=>post('error',{message:error instanceof Error?(error.stack||error.message):String(error||'차트 오류')});let priceChart,rsiChart,candles,volume,ma5,ma20,ma60,rsi,markers,lastReset=-1,currentSignals=new Map();
    const add=(chart,kind,options)=>chart['add'+kind+'Series']?chart['add'+kind+'Series'](options):chart.addSeries(LightweightCharts[kind+'Series'],options);
    const options={layout:{background:{type:'solid',color:'#101820'},textColor:'#9caeb9'},grid:{vertLines:{color:'rgba(124,151,166,.14)'},horzLines:{color:'rgba(124,151,166,.14)'}},rightPriceScale:{borderColor:'#2a3b45'},timeScale:{borderColor:'#2a3b45',timeVisible:true,secondsVisible:false},crosshair:{mode:LightweightCharts.CrosshairMode?.Normal??0},handleScroll:true,handleScale:true};
    const chart=(el,extra={})=>LightweightCharts.createChart(el,{...options,...extra,width:el.clientWidth,height:el.clientHeight});
    const resize=()=>{if(!priceChart)return;priceChart.resize(pricePane.clientWidth,pricePane.clientHeight);rsiChart.resize(rsiPane.clientWidth,rsiPane.clientHeight)};
    const markerData=(signals,candleTimes)=>{const grouped=new Map();for(const signal of signals){if(!candleTimes.has(signal.time))continue;const list=grouped.get(signal.time)||[];list.push(signal);grouped.set(signal.time,list)}currentSignals=grouped;return [...grouped.entries()].map(([time,list])=>{const sell=list.some(x=>/sell|매도|risk|리스크/i.test(x.type+' '+x.label));const buy=list.some(x=>/buy|매수/i.test(x.type+' '+x.label));const breakout=list.some(x=>x.type==='breakout'||/돌파/.test(x.label));const labels=list.map(x=>x.label).filter((v,i,a)=>a.indexOf(v)===i);return{time,position:sell?'aboveBar':buy?'belowBar':'aboveBar',color:sell?'#ff6b7a':buy?'#38d9a9':'#ffbd59',shape:sell?'arrowDown':buy?'arrowUp':'circle',text:labels.join(' · ')}})};
    const init=()=>{if(!window.LightweightCharts){post('error',{message:'번들 차트 라이브러리를 불러오지 못했습니다.'});return}const pricePane=document.getElementById('pricePane'),rsiPane=document.getElementById('rsiPane');priceChart=chart(pricePane);rsiChart=chart(rsiPane,{rightPriceScale:{borderColor:'#2a3b45',scaleMargins:{top:.12,bottom:.12}}});candles=add(priceChart,'Candlestick',{upColor:'#ef5350',downColor:'#4aa3ff',borderVisible:false,wickUpColor:'#ef5350',wickDownColor:'#4aa3ff'});volume=add(priceChart,'Histogram',{priceFormat:{type:'volume'},priceScaleId:''});volume.priceScale().applyOptions({scaleMargins:{top:.78,bottom:0}});ma5=add(priceChart,'Line',{color:'#ffbd59',lineWidth:1,visible:true});ma20=add(priceChart,'Line',{color:'#44c6e8',lineWidth:2,visible:true});ma60=add(priceChart,'Line',{color:'#b68cff',lineWidth:2,visible:true});rsi=add(rsiChart,'Line',{color:'#b68cff',lineWidth:2});const upper=rsi.createPriceLine({price:70,color:'rgba(255,107,122,.65)',lineStyle:2,axisLabelVisible:true,title:'70'});const lower=rsi.createPriceLine({price:30,color:'rgba(56,217,169,.65)',lineStyle:2,axisLabelVisible:true,title:'30'});void upper;void lower;priceChart.timeScale().subscribeVisibleLogicalRangeChange(range=>{if(range)rsiChart.timeScale().setVisibleLogicalRange(range)});priceChart.subscribeCrosshairMove(param=>{const time=Number(param.time);const list=currentSignals.get(time);post('signal',{text:list?.length?list.map(x=>`${x.label} · ${x.reason}${x.price?` · ${x.price}`:''}`).join('\n'):''})});pricePane.addEventListener('dblclick',()=>{priceChart.timeScale().fitContent();priceChart.priceScale('right').applyOptions({autoScale:true})});new ResizeObserver(resize).observe(document.getElementById('root'));post('ready')};
    window.renderChart=(payload)=>{if(!priceChart)return;const c=payload.candles||[],series=payload.series||{},o=payload.options||{},root=document.getElementById('root'),rsiPane=document.getElementById('rsiPane');candles.setData(c);volume.setData(c.map(x=>({time:x.time,value:x.volume,color:x.close>=x.open?'rgba(239,83,80,.32)':'rgba(74,163,255,.32)'})));ma5.setData(series.ma5||[]);ma20.setData(series.ma20||[]);ma60.setData(series.ma60||[]);rsi.setData(series.rsi||[]);ma5.applyOptions({visible:!!o.showMA5});ma20.applyOptions({visible:!!o.showMA20});ma60.applyOptions({visible:!!o.showMA60});rsiPane.classList.toggle('hidden',!o.showRSI);root.style.gridTemplateRows=o.showRSI?'minmax(0,1fr) 112px':'minmax(0,1fr)';if(LightweightCharts.createSeriesMarkers){if(!markers)markers=LightweightCharts.createSeriesMarkers(candles,markerData(payload.signals||[],new Set(c.map(x=>x.time))));else markers.setMarkers(markerData(payload.signals||[],new Set(c.map(x=>x.time))))}if(o.resetToken!==lastReset){lastReset=o.resetToken;priceChart.timeScale().fitContent();priceChart.priceScale('right').applyOptions({autoScale:true})}resize()};
    const start=()=>{try{init()}catch(error){fail(error)}};document.addEventListener('DOMContentLoaded',start);window.addEventListener('error',event=>fail(event.error||event.message));window.addEventListener('unhandledrejection',event=>fail(event.reason));})();
    </script></body></html>
    """#
}
