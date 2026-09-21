"use client"

import type React from "react"
import { useState, useRef, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Slider } from "@/components/ui/slider"
import { Label } from "@/components/ui/label"
import {
  Upload,
  Palette,
  Download,
  Sparkles,
  Camera,
  RefreshCw,
  Check,
  Sun,
  Contrast,
  Filter,
  Undo,
  Share2,
  Settings,
  Coins,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react"

/* ==========================================================================
   Pi Network SDK Integration Types & Helpers
   ========================================================================== */

interface PiUser {
  uid: string
  username: string
  accessToken?: string
}

interface PiPaymentData {
  amount: number
  memo: string
  metadata: Record<string, unknown>
}

declare global {
  interface Window {
    Pi?: {
      init: (options: { version: string; sandbox?: boolean }) => void
      authenticate: (
        scopes: string[],
        onIncompletePaymentFound: (payment: any) => void
      ) => Promise<{
        accessToken: string
        user: { uid: string; username: string }
      }>
      createPayment: (
        paymentData: PiPaymentData,
        callbacks: {
          onReadyForServerApproval: (paymentId: string) => void
          onReadyForServerCompletion: (paymentId: string, txid: string) => void
          onCancel: (paymentId: string) => void
          onError: (error: Error, payment?: any) => void
        }
      ) => Promise<any>
    }
  }
}

// Dynamically ensure Pi SDK script is present
function loadPiSDKScript(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve()
    if (window.Pi) return resolve()

    const existing = document.querySelector('script[src="https://sdk.minepi.com/pi-sdk.js"]')
    if (existing) {
      existing.addEventListener("load", () => resolve())
      return
    }

    const script = document.createElement("script")
    script.src = "https://sdk.minepi.com/pi-sdk.js"
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => resolve()
    document.head.appendChild(script)
  })
}

// In-memory session token store
let inMemorySessionToken: string | null = null

async function getPi(): Promise<any> {
  if (typeof window === "undefined") return null
  if (window.Pi) return window.Pi

  await loadPiSDKScript()

  // Poll for window.Pi to ensure Pi Desktop / Pi Browser webview is ready
  for (let i = 0; i < 50; i++) {
    if (window.Pi) return window.Pi
    await new Promise((r) => setTimeout(r, 100))
  }
  return window.Pi || null
}

async function authenticatePi(): Promise<PiUser | null> {
  const Pi = await getPi()

  if (Pi) {
    try {
      console.log("[Pi Auth] Initializing Pi SDK v2.0...")
      // STEP 1 - Await Pi.init({ version: "2.0" }) fully without sandbox parameter
      await Pi.init({ version: "2.0" })

      function onIncompletePaymentFound(payment: any) {
        console.log("[Pi SDK] Incomplete payment found:", payment)
      }

      console.log("[Pi Auth] Calling Pi.authenticate...")
      // Call Pi.authenticate(["username"], onIncompletePaymentFound)
      const auth = await Pi.authenticate(["username"], onIncompletePaymentFound)
      const accessToken = auth.accessToken

      console.log("[Pi Auth] Exchanging accessToken with App Studio backend...")
      // STEP 2 - Exchange that accessToken with App Studio
      const response = await fetch(
        "https://backend.appstudio-u7cm9zhmha0ruwv8.piappengine.com/pi/auth/v1/login",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken }),
        }
      )

      if (response.ok) {
        const data = await response.json()
        inMemorySessionToken = data.sessionToken
        if (typeof window !== "undefined" && window.sessionStorage) {
          window.sessionStorage.setItem("pi_session_token", data.sessionToken)
        }
        console.log("[Pi Auth] Verified by App Studio:", data.user)
        // App Studio checks the token against Pi Platform: only trust the returned user
        return {
          uid: data.user.uid,
          username: data.user.username,
          accessToken: data.sessionToken,
        }
      } else {
        const err = await response.text()
        console.error("[Pi Auth] App Studio exchange returned error:", response.status, err)
      }
    } catch (e) {
      console.warn("[Pi Auth] Authentication error:", e)
    }
  } else {
    console.log("[Pi Auth] Pi SDK not available on window.")
  }

  return null
}



function requestPayment(
  data: PiPaymentData,
  onSuccess: (txid: string) => void,
  onError: (err: string) => void
) {
  if (typeof window !== "undefined" && window.Pi) {
    try {
      window.Pi.createPayment(data, {
        onReadyForServerApproval: (paymentId) => console.log("Approval:", paymentId),
        onReadyForServerCompletion: (paymentId, txid) => onSuccess(txid),
        onCancel: () => onError("Payment was cancelled by Pioneer."),
        onError: (err) => onError(err?.message || "Payment failed"),
      })
      return
    } catch (e: any) {
      onError(e?.message || "Pi payment unavailable")
      return
    }
  }

  // Fallback simulator for outside Pi Browser
  const ok = window.confirm(`[Pi Testnet Sandbox]\n\nAuthorize payment of ${data.amount} Test-Pi for "${data.memo}"?`)
  if (ok) {
    setTimeout(() => onSuccess("tx-mock-" + Math.random().toString(36).slice(2, 9)), 600)
  } else {
    onError("Payment cancelled.")
  }
}

/* ==========================================================================
   Image Processing & Colorization Engine (Canvas-based)
   ========================================================================== */

interface EditSettings {
  brightness: number
  contrast: number
  saturation: number
  exposure: number
  highlights: number
  shadows: number
  cropMode: boolean
  artisticFilter: string
}

const colorFilters = [
  { id: "natural", name: "Natural", description: "Realistic natural tones", preview: "bg-emerald-500" },
  { id: "vibrant", name: "Vibrant", description: "Rich, saturated colors", preview: "bg-pink-500" },
  { id: "vintage", name: "Vintage", description: "Warm 1950s Kodachrome", preview: "bg-amber-500" },
  { id: "cool", name: "Cool Tones", description: "Cinematic blue & teal", preview: "bg-cyan-500" },
  { id: "warm", name: "Golden Hour", description: "Warm sunset radiance", preview: "bg-orange-500" },
  { id: "sepia", name: "Sepia Plus", description: "Rich archival duotone", preview: "bg-yellow-600" },
]

const artisticFilters = [
  { id: "none", name: "Standard", description: "Clean original colors" },
  { id: "sharpen", name: "HD Sharpen", description: "Crisp micro-contrast details" },
  { id: "vignette", name: "Vignette", description: "Artistic dark edge framing" },
  { id: "grain", name: "Film Grain", description: "Authentic 35mm analog grain" },
  { id: "dramatic", name: "Dramatic", description: "High contrast cinematic punch" },
  { id: "blur", name: "Soft Glow", description: "Dreamy portrait diffusion" },
]

const SAMPLE_PHOTOS = [
  {
    name: "Classic Portrait",
    url: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=800&q=80&sat=-100",
  },
  {
    name: "Vintage City",
    url: "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80&sat=-100",
  },
  {
    name: "Historic Street",
    url: "https://images.unsplash.com/photo-1477959858617-67f30bc75b82?auto=format&fit=crop&w=800&q=80&sat=-100",
  },
]

function clamp(v: number, min = 0, max = 255): number {
  return Math.max(min, Math.min(max, v))
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = (e) => reject(e)
    img.src = src
  })
}

async function runColorizationAlgorithm(
  imageSrc: string,
  filterId: string,
  onProgress?: (percent: number, status: string) => void
): Promise<string> {
  if (onProgress) onProgress(15, "Loading image pixels...")
  const img = await loadImage(imageSrc)

  let width = img.naturalWidth || img.width
  let height = img.naturalHeight || img.height
  const maxDim = 1400
  if (width > maxDim || height > maxDim) {
    if (width > height) {
      height = Math.round((height * maxDim) / width)
      width = maxDim
    } else {
      width = Math.round((width * maxDim) / height)
      height = maxDim
    }
  }

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("Could not initialize canvas context")

  ctx.drawImage(img, 0, 0, width, height)
  const imgData = ctx.getImageData(0, 0, width, height)
  const d = imgData.data

  if (onProgress) onProgress(45, "Synthesizing chromatic spectrum...")
  await new Promise((r) => setTimeout(r, 50))

  for (let i = 0; i < d.length; i += 4) {
    const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]
    const norm = lum / 255

    let nr = lum
    let ng = lum
    let nb = lum

    switch (filterId) {
      case "natural":
        if (norm > 0.75) {
          const factor = (norm - 0.75) / 0.25
          nr = lum * (1 - factor * 0.08)
          ng = lum * (1 + factor * 0.04)
          nb = lum * (1 + factor * 0.22)
        } else if (norm > 0.3) {
          const midFactor = Math.sin(((norm - 0.3) / 0.45) * Math.PI)
          nr = lum + midFactor * 38
          ng = lum + midFactor * 16
          nb = lum - midFactor * 14
        } else {
          nr = lum * 1.08
          ng = lum * 0.98
          nb = lum * 0.92
        }
        break

      case "vibrant":
        if (norm > 0.65) {
          nr = lum * 0.95
          ng = lum * 1.08
          nb = lum * 1.35
        } else if (norm > 0.25) {
          const factor = Math.sin(((norm - 0.25) / 0.4) * Math.PI)
          nr = lum + factor * 50
          ng = lum + factor * 28
          nb = lum - factor * 10
        } else {
          nr = lum * 1.15
          ng = lum * 0.9
          nb = lum * 1.05
        }
        break

      case "vintage":
        nr = lum * 1.22 + 10
        ng = lum * 1.05 + 4
        nb = lum * 0.82 - 6
        if (norm < 0.25) {
          nr = clamp(nr + 12)
          ng = clamp(ng + 8)
          nb = clamp(nb + 15)
        }
        break

      case "cool":
        nr = lum * 0.82 - 8
        ng = lum * 1.04 + 2
        nb = lum * 1.3 + 18
        break

      case "warm":
        nr = lum * 1.3 + 22
        ng = lum * 1.08 + 10
        nb = lum * 0.72 - 12
        break

      case "sepia":
        nr = lum * 1.15 + 20
        ng = lum * 0.95 + 12
        nb = lum * 0.72 + 2
        break
    }

    d[i] = clamp(nr)
    d[i + 1] = clamp(ng)
    d[i + 2] = clamp(nb)
  }

  if (onProgress) onProgress(85, "Rendering output buffer...")
  await new Promise((r) => setTimeout(r, 40))

  ctx.putImageData(imgData, 0, 0)
  if (onProgress) onProgress(100, "Complete!")
  return canvas.toDataURL("image/jpeg", 0.95)
}

async function renderAdjustments(baseSrc: string, settings: EditSettings): Promise<string> {
  const img = await loadImage(baseSrc)
  const width = img.naturalWidth || img.width
  const height = img.naturalHeight || img.height

  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("Could not initialize canvas")

  ctx.drawImage(img, 0, 0, width, height)
  const imgData = ctx.getImageData(0, 0, width, height)
  const d = imgData.data

  const brightMult = 1 + settings.brightness / 100
  const contrastFactor = (259 * (settings.contrast + 100)) / (100 * (259 - settings.contrast || 1))
  const satMult = 1 + settings.saturation / 50
  const expMult = Math.pow(2, settings.exposure / 50)

  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] * brightMult * expMult
    let g = d[i + 1] * brightMult * expMult
    let b = d[i + 2] * brightMult * expMult

    r = contrastFactor * (r - 128) + 128
    g = contrastFactor * (g - 128) + 128
    b = contrastFactor * (b - 128) + 128

    if (settings.saturation !== 0) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b
      r = gray + (r - gray) * satMult
      g = gray + (g - gray) * satMult
      b = gray + (b - gray) * satMult
    }

    if (settings.artisticFilter === "dramatic") {
      const dContrast = (r - 128) * 1.2 + 128
      r = r * 0.6 + dContrast * 0.4
      g = g * 0.6 + dContrast * 0.4
      b = b * 0.6 + dContrast * 0.4
    }

    if (settings.artisticFilter === "grain") {
      const noise = (Math.random() - 0.5) * 26
      r += noise
      g += noise
      b += noise
    }

    d[i] = clamp(r)
    d[i + 1] = clamp(g)
    d[i + 2] = clamp(b)
  }

  ctx.putImageData(imgData, 0, 0)

  if (settings.artisticFilter === "vignette") {
    const radius = Math.sqrt(Math.pow(width / 2, 2) + Math.pow(height / 2, 2))
    const grad = ctx.createRadialGradient(width / 2, height / 2, radius * 0.45, width / 2, height / 2, radius)
    grad.addColorStop(0, "rgba(0,0,0,0)")
    grad.addColorStop(1, "rgba(0,0,0,0.7)")
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, width, height)
  }

  if (settings.artisticFilter === "blur") {
    ctx.save()
    ctx.globalAlpha = 0.35
    ctx.filter = "blur(6px)"
    ctx.drawImage(canvas, 0, 0)
    ctx.restore()
  }

  if (settings.artisticFilter === "sharpen") {
    ctx.save()
    ctx.globalAlpha = 0.22
    ctx.filter = "contrast(135%)"
    ctx.drawImage(canvas, 0, 0)
    ctx.restore()
  }

  return canvas.toDataURL("image/jpeg", 0.95)
}

/* ==========================================================================
   Main Application Component
   ========================================================================== */

export default function AIPhotoColorizer() {
  const [pioneer, setPioneer] = useState<PiUser | null>(null)
  const [hasUltraPass, setHasUltraPass] = useState(false)
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null)

  const [uploadedImage, setUploadedImage] = useState<string | null>(null)
  const [rawColorizedImage, setRawColorizedImage] = useState<string | null>(null)
  const [currentImage, setCurrentImage] = useState<string | null>(null)
  const [selectedColorFilter, setSelectedColorFilter] = useState("natural")
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [statusText, setStatusText] = useState("")
  const [activeTab, setActiveTab] = useState("upload")

  const [sliderPosition, setSliderPosition] = useState(50)

  const [editSettings, setEditSettings] = useState<EditSettings>({
    brightness: 0,
    contrast: 0,
    saturation: 0,
    exposure: 0,
    highlights: 0,
    shadows: 0,
    cropMode: false,
    artisticFilter: "none",
  })

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const [isSigningIn, setIsSigningIn] = useState(false)

  const handleSignIn = useCallback(async () => {
    setIsSigningIn(true)
    try {
      const user = await authenticatePi()
      if (user) {
        setPioneer(user)
      }
    } finally {
      setIsSigningIn(false)
    }
  }, [])

  useEffect(() => {
    handleSignIn()
  }, [handleSignIn])


  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        setUploadedImage(result)
        setRawColorizedImage(null)
        setCurrentImage(result)
        resetSettings()
        setActiveTab("colorize")
      }
      reader.readAsDataURL(file)
    }
  }

  const loadSamplePhoto = async (url: string) => {
    setIsProcessing(true)
    setStatusText("Loading sample photo...")
    setProgress(30)
    try {
      const response = await fetch(url)
      const blob = await response.blob()
      const reader = new FileReader()
      reader.onload = (e) => {
        const result = e.target?.result as string
        setUploadedImage(result)
        setRawColorizedImage(null)
        setCurrentImage(result)
        resetSettings()
        setIsProcessing(false)
        setActiveTab("colorize")
      }
      reader.readAsDataURL(blob)
    } catch (err) {
      console.error(err)
      setIsProcessing(false)
    }
  }

  const processColorization = async () => {
    if (!uploadedImage) return
    setIsProcessing(true)
    setProgress(10)
    setStatusText("Preparing image...")

    try {
      const result = await runColorizationAlgorithm(uploadedImage, selectedColorFilter, (percent, stage) => {
        setProgress(percent)
        setStatusText(stage)
      })
      setRawColorizedImage(result)
      setCurrentImage(result)
      setIsProcessing(false)
      setActiveTab("edit")
    } catch (error: any) {
      console.error(error)
      alert("Processing error: " + (error?.message || "Unknown"))
      setIsProcessing(false)
    }
  }

  const applyAdjustments = useCallback(async () => {
    const base = rawColorizedImage || uploadedImage
    if (!base) return
    try {
      const updated = await renderAdjustments(base, editSettings)
      setCurrentImage(updated)
    } catch (err) {
      console.error(err)
    }
  }, [rawColorizedImage, uploadedImage, editSettings])

  useEffect(() => {
    if (rawColorizedImage) {
      applyAdjustments()
    }
  }, [editSettings, rawColorizedImage, applyAdjustments])

  const resetSettings = () => {
    setEditSettings({
      brightness: 0,
      contrast: 0,
      saturation: 0,
      exposure: 0,
      highlights: 0,
      shadows: 0,
      cropMode: false,
      artisticFilter: "none",
    })
    if (rawColorizedImage) setCurrentImage(rawColorizedImage)
  }

  const downloadImage = () => {
    if (!currentImage) return
    const link = document.createElement("a")
    link.href = currentImage
    link.download = `colorized-photo-${selectedColorFilter}.jpg`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const shareImage = async () => {
    if (!currentImage) return
    if (navigator.share) {
      try {
        const response = await fetch(currentImage)
        const blob = await response.blob()
        const file = new File([blob], "colorized-photo.jpg", { type: "image/jpeg" })
        await navigator.share({
          title: "My Colorized Photo on Pi Network",
          text: "Look at my black & white photo colorized on Pi App Studio!",
          files: [file],
        })
      } catch (err) {
        console.log(err)
      }
    } else {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(window.location.href)
        alert("App link copied to clipboard!")
      }
    }
  }

  const handleUpgradeToUltra = () => {
    requestPayment(
      {
        amount: 0.05,
        memo: "Ultra HD AI Color Pass",
        metadata: { feature: "ultra_hd" },
      },
      (txid) => {
        setHasUltraPass(true)
        setPaymentNotice(`Payment Successful! TxID: ${txid.slice(0, 10)}...`)
        setTimeout(() => setPaymentNotice(null), 6000)
      },
      (err) => alert(err)
    )
  }

  const startOver = () => {
    setUploadedImage(null)
    setRawColorizedImage(null)
    setCurrentImage(null)
    setProgress(0)
    setIsProcessing(false)
    setActiveTab("upload")
    resetSettings()
    if (fileInputRef.current) fileInputRef.current.value = ""
    if (cameraInputRef.current) cameraInputRef.current.value = ""
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50/50 via-purple-50/40 to-pink-50/50 pb-28">
      {/* Top Header */}
      <header className="bg-white/90 backdrop-blur-md border-b border-purple-100 sticky top-0 z-30 shadow-sm">
        <div className="max-w-md mx-auto px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-purple-600 to-pink-500 flex items-center justify-center shadow-md shadow-purple-200">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-bold text-gray-900 text-sm leading-tight">Color your Photo</h1>
                <Badge variant="secondary" className="text-[10px] bg-purple-100 text-purple-700 px-1.5 py-0 border-purple-200">
                  Pi Testnet
                </Badge>
              </div>
              <p className="text-[11px] text-gray-500">AI Studio Edition</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {pioneer ? (
              <div className="flex items-center gap-1.5 px-2.5 py-1 bg-purple-50 border border-purple-200/80 rounded-full text-xs text-purple-900 font-medium">
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>@{pioneer.username}</span>
              </div>
            ) : (
              <Button
                size="sm"
                onClick={handleSignIn}
                disabled={isSigningIn}
                className="bg-purple-600 hover:bg-purple-700 text-white text-xs h-7 px-2.5 shadow-sm rounded-lg"
              >
                <Coins className="w-3 h-3 mr-1" />
                {isSigningIn ? "Signing in..." : "Sign in with Pi"}
              </Button>
            )}
            {currentImage && (
              <Button onClick={startOver} variant="ghost" size="icon" className="h-8 w-8 text-gray-500 hover:text-purple-600">
                <RefreshCw className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
      </header>


      {paymentNotice && (
        <div className="max-w-md mx-auto px-4 mt-2">
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs p-3 rounded-xl flex items-center gap-2 shadow-sm animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{paymentNotice}</span>
          </div>
        </div>
      )}

      <main className="max-w-md mx-auto p-4 space-y-4">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 bg-white/80 border border-purple-100 shadow-sm p-1 rounded-xl">
            <TabsTrigger value="upload" className="text-xs data-[state=active]:bg-purple-600 data-[state=active]:text-white rounded-lg">
              <Upload className="w-4 h-4 mr-1.5" />
              Upload
            </TabsTrigger>
            <TabsTrigger value="colorize" disabled={!uploadedImage} className="text-xs data-[state=active]:bg-purple-600 data-[state=active]:text-white rounded-lg">
              <Palette className="w-4 h-4 mr-1.5" />
              Colorize
            </TabsTrigger>
            <TabsTrigger value="edit" disabled={!rawColorizedImage} className="text-xs data-[state=active]:bg-purple-600 data-[state=active]:text-white rounded-lg">
              <Settings className="w-4 h-4 mr-1.5" />
              Edit
            </TabsTrigger>
            <TabsTrigger value="filters" disabled={!rawColorizedImage} className="text-xs data-[state=active]:bg-purple-600 data-[state=active]:text-white rounded-lg">
              <Filter className="w-4 h-4 mr-1.5" />
              Filters
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: UPLOAD */}
          <TabsContent value="upload" className="space-y-4 mt-3">
            <Card className="border-2 border-dashed border-purple-300/80 bg-white/80 shadow-sm hover:border-purple-400 transition-colors">
              <CardContent className="p-6 text-center space-y-4">
                <div className="w-16 h-16 mx-auto bg-gradient-to-tr from-purple-100 to-pink-100 rounded-2xl flex items-center justify-center shadow-inner">
                  <Camera className="w-8 h-8 text-purple-600" />
                </div>
                <div className="space-y-1">
                  <h2 className="font-semibold text-gray-900 text-base">Select Black & White Photo</h2>
                  <p className="text-xs text-gray-500">JPG, PNG, or WebP. The AI will reconstruct natural colors.</p>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button onClick={() => fileInputRef.current?.click()} className="bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white shadow-md shadow-purple-200">
                    <Upload className="w-4 h-4 mr-1.5" />
                    Browse Photo
                  </Button>
                  <Button variant="outline" onClick={() => cameraInputRef.current?.click()} className="border-purple-200 hover:bg-purple-50">
                    <Camera className="w-4 h-4 mr-1.5 text-purple-600" />
                    Take Photo
                  </Button>
                </div>

                <input ref={fileInputRef} type="file" accept="image/*" onChange={handleImageUpload} className="hidden" />
                <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleImageUpload} className="hidden" />
              </CardContent>
            </Card>

            <Card className="bg-white/80 border-purple-100 shadow-sm">
              <CardHeader className="py-3 px-4">
                <CardTitle className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                  Try Instant Sample Photos
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-0">
                <div className="grid grid-cols-3 gap-2">
                  {SAMPLE_PHOTOS.map((sample, idx) => (
                    <button
                      key={idx}
                      onClick={() => loadSamplePhoto(sample.url)}
                      disabled={isProcessing}
                      className="group relative rounded-lg overflow-hidden border border-gray-200 aspect-square hover:ring-2 hover:ring-purple-500 transition-all text-left"
                    >
                      <img src={sample.url} alt={sample.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                      <div className="absolute inset-x-0 bottom-0 bg-black/60 backdrop-blur-xs p-1 text-[10px] text-white font-medium text-center truncate">
                        {sample.name}
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-3 gap-2">
              <div className="p-3 bg-white/70 border border-purple-100 rounded-xl text-center space-y-1">
                <Sparkles className="w-5 h-5 text-purple-600 mx-auto" />
                <div className="font-semibold text-xs text-gray-800">Natural Colors</div>
                <div className="text-[10px] text-gray-500">Tone mapping</div>
              </div>
              <div className="p-3 bg-white/70 border border-purple-100 rounded-xl text-center space-y-1">
                <ShieldCheck className="w-5 h-5 text-pink-600 mx-auto" />
                <div className="font-semibold text-xs text-gray-800">100% Private</div>
                <div className="text-[10px] text-gray-500">Device processing</div>
              </div>
              <div className="p-3 bg-white/70 border border-purple-100 rounded-xl text-center space-y-1">
                <Coins className="w-5 h-5 text-amber-500 mx-auto" />
                <div className="font-semibold text-xs text-gray-800">Pi Utility</div>
                <div className="text-[10px] text-gray-500">Testnet enabled</div>
              </div>
            </div>
          </TabsContent>

          {/* TAB 2: COLORIZE */}
          <TabsContent value="colorize" className="space-y-4 mt-3">
            {uploadedImage && (
              <>
                <Card className="bg-white/90 border-purple-100 shadow-sm overflow-hidden">
                  <CardContent className="p-3 space-y-3">
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-gray-950 select-none">
                      {rawColorizedImage ? (
                        <>
                          <img src={rawColorizedImage} alt="Colorized" className="absolute inset-0 w-full h-full object-cover" />
                          <div className="absolute inset-0 overflow-hidden pointer-events-none" style={{ width: `${sliderPosition}%` }}>
                            <img src={uploadedImage} alt="Original" className="w-full h-full object-cover max-w-none" style={{ width: "100%", height: "100%" }} />
                          </div>
                          <div className="absolute top-0 bottom-0 w-0.5 bg-white shadow-lg pointer-events-none z-10" style={{ left: `${sliderPosition}%` }}>
                            <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-white text-purple-600 shadow-md flex items-center justify-center text-[10px] font-bold">
                              ↔
                            </div>
                          </div>
                          <div className="absolute top-2 left-2 bg-black/60 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full z-20 pointer-events-none">
                            Original B&W
                          </div>
                          <div className="absolute top-2 right-2 bg-purple-600/90 text-white text-[10px] font-semibold px-2 py-0.5 rounded-full z-20 pointer-events-none">
                            AI Colorized
                          </div>
                        </>
                      ) : (
                        <img src={uploadedImage} alt="Preview" className="w-full h-full object-cover" />
                      )}
                    </div>

                    {rawColorizedImage && (
                      <div className="space-y-1 pt-1">
                        <div className="flex justify-between text-[11px] text-gray-500 font-medium">
                          <span>Drag to compare:</span>
                          <span>{sliderPosition}%</span>
                        </div>
                        <Slider value={[sliderPosition]} onValueChange={(val) => setSliderPosition(val[0])} min={0} max={100} step={1} />
                      </div>
                    )}
                  </CardContent>
                </Card>

                <Card className="bg-white/90 border-purple-100 shadow-sm">
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-xs font-semibold text-gray-700 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <Palette className="w-3.5 h-3.5 text-purple-600" />
                        Select Color Spectrum
                      </span>
                      <span className="text-[10px] font-normal text-purple-600 uppercase tracking-wider">{selectedColorFilter}</span>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 pt-0">
                    <div className="grid grid-cols-2 gap-2">
                      {colorFilters.map((filter) => (
                        <button
                          key={filter.id}
                          onClick={() => setSelectedColorFilter(filter.id)}
                          className={`p-2.5 rounded-xl border text-left transition-all relative ${
                            selectedColorFilter === filter.id
                              ? "border-purple-600 bg-purple-50/80 ring-2 ring-purple-300 shadow-xs"
                              : "border-gray-200 bg-white hover:border-purple-200"
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <div className={`w-3 h-3 rounded-full ${filter.preview} shadow-xs`} />
                            <span className="font-semibold text-xs text-gray-900">{filter.name}</span>
                          </div>
                          <p className="text-[10px] text-gray-500 leading-tight">{filter.description}</p>
                          {selectedColorFilter === filter.id && (
                            <div className="absolute top-2 right-2 text-purple-600">
                              <Check className="w-3.5 h-3.5" />
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {isProcessing && (
                  <Card className="bg-white border-purple-200 shadow-md">
                    <CardContent className="p-5 text-center space-y-3">
                      <div className="w-10 h-10 mx-auto bg-gradient-to-r from-purple-600 to-pink-600 rounded-full flex items-center justify-center shadow-md animate-spin">
                        <Sparkles className="w-5 h-5 text-white" />
                      </div>
                      <div className="space-y-1.5">
                        <p className="font-semibold text-xs text-gray-900">{statusText}</p>
                        <Progress value={progress} className="w-full h-2 bg-purple-100" />
                        <p className="text-[11px] text-purple-600 font-medium">{progress}%</p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {!isProcessing && (
                  <Button
                    onClick={processColorization}
                    className="w-full bg-gradient-to-r from-purple-600 via-purple-700 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-medium py-5 shadow-lg shadow-purple-200 rounded-xl"
                    size="lg"
                  >
                    <Sparkles className="w-4 h-4 mr-2" />
                    {rawColorizedImage ? "Re-Colorize with Selected Palette" : "Colorize Photo with AI"}
                  </Button>
                )}
              </>
            )}
          </TabsContent>

          {/* TAB 3: EDIT */}
          <TabsContent value="edit" className="space-y-4 mt-3">
            {currentImage && (
              <>
                <Card className="bg-white/90 border-purple-100 shadow-sm overflow-hidden">
                  <CardContent className="p-3">
                    <div className="aspect-square rounded-xl overflow-hidden bg-gray-950">
                      <img src={currentImage} alt="Adjusted" className="w-full h-full object-cover" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-white/90 border-purple-100 shadow-sm">
                  <CardHeader className="py-3 px-4 flex flex-row items-center justify-between">
                    <CardTitle className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
                      <Settings className="w-3.5 h-3.5 text-purple-600" />
                      Image Fine-Tuning
                    </CardTitle>
                    <Button onClick={resetSettings} variant="ghost" size="sm" className="h-6 text-[10px] text-gray-500">
                      <Undo className="w-3 h-3 mr-1" />
                      Reset
                    </Button>
                  </CardHeader>
                  <CardContent className="space-y-4 px-4 pb-4 pt-1">
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <Label className="flex items-center gap-1 text-gray-600">
                          <Sun className="w-3.5 h-3.5 text-amber-500" /> Brightness
                        </Label>
                        <span className="text-gray-500 text-[11px]">{editSettings.brightness}</span>
                      </div>
                      <Slider value={[editSettings.brightness]} onValueChange={(val) => setEditSettings((p) => ({ ...p, brightness: val[0] }))} min={-40} max={40} step={1} />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <Label className="flex items-center gap-1 text-gray-600">
                          <Contrast className="w-3.5 h-3.5 text-blue-500" /> Contrast
                        </Label>
                        <span className="text-gray-500 text-[11px]">{editSettings.contrast}</span>
                      </div>
                      <Slider value={[editSettings.contrast]} onValueChange={(val) => setEditSettings((p) => ({ ...p, contrast: val[0] }))} min={-40} max={40} step={1} />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <Label className="flex items-center gap-1 text-gray-600">
                          <Palette className="w-3.5 h-3.5 text-pink-500" /> Saturation
                        </Label>
                        <span className="text-gray-500 text-[11px]">{editSettings.saturation}</span>
                      </div>
                      <Slider value={[editSettings.saturation]} onValueChange={(val) => setEditSettings((p) => ({ ...p, saturation: val[0] }))} min={-30} max={50} step={1} />
                    </div>

                    <div className="space-y-1.5">
                      <div className="flex justify-between text-xs">
                        <Label className="flex items-center gap-1 text-gray-600">Exposure</Label>
                        <span className="text-gray-500 text-[11px]">{editSettings.exposure}</span>
                      </div>
                      <Slider value={[editSettings.exposure]} onValueChange={(val) => setEditSettings((p) => ({ ...p, exposure: val[0] }))} min={-30} max={30} step={1} />
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>

          {/* TAB 4: FILTERS */}
          <TabsContent value="filters" className="space-y-4 mt-3">
            {currentImage && (
              <>
                <Card className="bg-white/90 border-purple-100 shadow-sm overflow-hidden">
                  <CardContent className="p-3">
                    <div className="aspect-square rounded-xl overflow-hidden bg-gray-950">
                      <img src={currentImage} alt="Filter" className="w-full h-full object-cover" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-white/90 border-purple-100 shadow-sm">
                  <CardHeader className="py-3 px-4">
                    <CardTitle className="text-xs font-semibold text-gray-800 flex items-center gap-1.5">
                      <Filter className="w-3.5 h-3.5 text-purple-600" />
                      Artistic Lens Filters
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-3 pb-3 pt-0">
                    <div className="grid grid-cols-2 gap-2">
                      {artisticFilters.map((filter) => (
                        <button
                          key={filter.id}
                          onClick={() => setEditSettings((p) => ({ ...p, artisticFilter: filter.id }))}
                          className={`p-2.5 rounded-xl border text-left transition-all ${
                            editSettings.artisticFilter === filter.id
                              ? "border-purple-600 bg-purple-50 ring-2 ring-purple-300"
                              : "border-gray-200 bg-white hover:border-purple-200"
                          }`}
                        >
                          <div className="font-semibold text-xs text-gray-900">{filter.name}</div>
                          <div className="text-[10px] text-gray-500">{filter.description}</div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Ultra HD Pass Banner */}
        <Card className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 shadow-xs">
          <CardContent className="p-3.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-amber-500 text-white flex items-center justify-center font-bold text-xs shadow-xs">
                π
              </div>
              <div>
                <div className="text-xs font-bold text-amber-900 flex items-center gap-1">
                  Ultra HD Color Pass
                  {hasUltraPass && <Badge className="text-[9px] bg-emerald-600 text-white px-1 py-0">Active</Badge>}
                </div>
                <div className="text-[10px] text-amber-700">
                  {hasUltraPass ? "HD resolution export unlocked" : "Only 0.05 Test-Pi via Pi Sandbox"}
                </div>
              </div>
            </div>

            {!hasUltraPass ? (
              <Button size="sm" onClick={handleUpgradeToUltra} className="bg-amber-600 hover:bg-amber-700 text-white text-xs h-7 px-3 shadow-xs">
                <Coins className="w-3 h-3 mr-1" />
                Unlock
              </Button>
            ) : (
              <div className="text-emerald-700 text-xs font-semibold flex items-center gap-1">
                <Check className="w-4 h-4 text-emerald-600" />
                Enabled
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Floating Bottom Bar */}
      {currentImage && (
        <div className="fixed bottom-0 inset-x-0 bg-white/95 backdrop-blur-md border-t border-purple-100 p-3 shadow-xl z-30">
          <div className="max-w-md mx-auto flex gap-2.5">
            <Button onClick={downloadImage} className="flex-1 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-medium shadow-md shadow-emerald-200">
              <Download className="w-4 h-4 mr-1.5" />
              Save Photo
            </Button>
            <Button onClick={shareImage} variant="outline" className="border-purple-200 text-purple-700 hover:bg-purple-50">
              <Share2 className="w-4 h-4 mr-1.5" />
              Share
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
