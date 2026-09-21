import { NextRequest, NextResponse } from "next/server";
import { Client } from "@gradio/client";

export const maxDuration = 60; // Allow enough time for AI processing

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { image } = body;

    if (!image || typeof image !== "string") {
      return NextResponse.json({ success: false, error: "Image data is required" }, { status: 400 });
    }

    // Convert data URL to Blob
    let imageBlob: Blob;
    if (image.startsWith("data:")) {
      const parts = image.split(";base64,");
      const mime = parts[0].split(":")[1] || "image/jpeg";
      const base64Data = parts[1];
      const buffer = Buffer.from(base64Data, "base64");
      imageBlob = new Blob([buffer], { type: mime });
    } else {
      // If direct URL
      const resp = await fetch(image);
      imageBlob = await resp.blob();
    }

    // Connect to free DDColor AI space
    const client = await Client.connect("Rwendoll/DDColor-Photo-Restoration");
    const result: any = await client.predict("/restore_photo", {
      input_image: imageBlob,
    });

    if (!result?.data || !result.data[0]) {
      throw new Error("Invalid response from DDColor model");
    }

    const outputObj = result.data[0];
    const outputUrl = outputObj.url || outputObj.path;

    if (!outputUrl) {
      throw new Error("No image output URL returned from AI");
    }

    // Download the result image and convert to base64 data URL so it's persistent and cross-origin safe
    const resImg = await fetch(outputUrl);
    const arrayBuffer = await resImg.arrayBuffer();
    const outBase64 = Buffer.from(arrayBuffer).toString("base64");
    const contentType = resImg.headers.get("content-type") || "image/jpeg";
    const dataUrl = `data:${contentType};base64,${outBase64}`;

    return NextResponse.json({
      success: true,
      image: dataUrl,
      source: "ddcolor-ai",
    });
  } catch (error: any) {
    console.error("AI Colorization Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error?.message || "Internal server error during AI colorization",
      },
      { status: 500 }
    );
  }
}
