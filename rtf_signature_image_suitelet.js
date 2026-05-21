/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 *
 * Converts an RTF file that contains an embedded PNG/JPEG picture into a
 * File Cabinet image. This does not render arbitrary RTF layout; it extracts
 * the embedded image data from an RTF {\pict ... \pngblip|\jpegblip ...}.
 */
define(['N/encode', 'N/file', 'N/log', 'N/ui/serverWidget'], (
  encode,
  file,
  log,
  serverWidget
) => {
  const PARAM_RTF_FILE_ID = 'rtfFileId';
  const PARAM_OUTPUT_FOLDER_ID = 'folderId';
  const PARAM_JSON = 'json';

  function onRequest(context) {
    try {
      if (context.request.method === 'POST') {
        const rtfFileId =68944
        const outputFolderId = null;

        const result = convertRtfEmbeddedImage({
          rtfFileId,
          outputFolderId
        });

        if (context.request.parameters[PARAM_JSON] === 'T') {
          writeJson(context, result);
          return;
        }

        writeResultPage(context, result);
        return;
      }

      writeForm(context);
    } catch (e) {
      log.error({
        title: 'RTF image conversion failed',
        details: e
      });

      if (context.request.parameters[PARAM_JSON] === 'T') {
        writeJson(context, {
          success: false,
          message: e.message || String(e)
        });
        return;
      }

      writeErrorPage(context, e);
    }
  }

  function convertRtfEmbeddedImage(options) {
    const rtfFile = file.load({
      id: options.rtfFileId
    });

    const rtfContents = rtfFile.getContents();
    const extracted = extractFirstEmbeddedImage(rtfContents);

    const baseName = getBaseName(rtfFile.name || `rtf_${options.rtfFileId}`);
    const imageName = `${baseName}_signature_${Date.now()}.${extracted.extension}`;

    const imageFile = file.create({
      name: imageName,
      fileType: extracted.fileType,
      contents: extracted.base64,
      folder: Number(options.outputFolderId),
      isOnline: true
    });

    const imageFileId = imageFile.save();
    const savedImage = file.load({
      id: imageFileId
    });

    return {
      success: true,
      sourceRtfFileId: String(options.rtfFileId),
      imageFileId: String(imageFileId),
      imageUrl: savedImage.url,
      imageName,
      imageType: extracted.extension
    };
  }

  function extractFirstEmbeddedImage(rtfContents) {
    const pictGroups = findPictGroups(rtfContents);

    for (let i = 0; i < pictGroups.length; i += 1) {
      const group = pictGroups[i];
      const isPng = /\\pngblip\b/i.test(group);
      const isJpeg = /\\jpegblip\b/i.test(group);

      if (!isPng && !isJpeg) {
        continue;
      }

      const hex = extractHexImageData(group, isPng ? 'png' : 'jpg');
      if (!hex) {
        continue;
      }

      return {
        extension: isPng ? 'png' : 'jpg',
        fileType: isPng ? file.Type.PNGIMAGE : file.Type.JPGIMAGE,
        base64: encode.convert({
          string: hex,
          inputEncoding: encode.Encoding.HEX,
          outputEncoding: encode.Encoding.BASE_64
        })
      };
    }

    throw new Error('No embedded PNG or JPEG image was found in the RTF file.');
  }

  function findPictGroups(rtf) {
    const groups = [];
    let searchIndex = 0;

    while (searchIndex < rtf.length) {
      const pictIndex = rtf.indexOf('{\\pict', searchIndex);
      if (pictIndex === -1) {
        break;
      }

      let depth = 0;
      let endIndex = -1;

      for (let i = pictIndex; i < rtf.length; i += 1) {
        const ch = rtf.charAt(i);
        const previous = i > 0 ? rtf.charAt(i - 1) : '';

        if (ch === '{' && previous !== '\\') {
          depth += 1;
        } else if (ch === '}' && previous !== '\\') {
          depth -= 1;
          if (depth === 0) {
            endIndex = i + 1;
            break;
          }
        }
      }

      if (endIndex === -1) {
        break;
      }

      groups.push(rtf.substring(pictIndex, endIndex));
      searchIndex = endIndex;
    }

    return groups;
  }

  function extractHexImageData(pictGroup, imageType) {
    let cleaned = pictGroup
      .replace(/\\[a-zA-Z]+-?\d* ?/g, ' ')
      .replace(/\\'([0-9a-fA-F]{2})/g, '$1')
      .replace(/\\[^a-zA-Z0-9]/g, ' ')
      .replace(/[{}]/g, ' ');

    cleaned = cleaned.replace(/[^0-9a-fA-F]/g, '').toLowerCase();

    if (imageType === 'png') {
      const pngStart = cleaned.indexOf('89504e470d0a1a0a');
      if (pngStart === -1) {
        return '';
      }
      cleaned = cleaned.substring(pngStart);
    } else {
      const jpgStart = cleaned.indexOf('ffd8');
      const jpgEnd = cleaned.lastIndexOf('ffd9');
      if (jpgStart === -1) {
        return '';
      }
      cleaned = jpgEnd > jpgStart ? cleaned.substring(jpgStart, jpgEnd + 4) : cleaned.substring(jpgStart);
    }

    if (cleaned.length % 2 !== 0) {
      cleaned = cleaned.substring(0, cleaned.length - 1);
    }

    return cleaned;
  }

  function writeForm(context) {
    const form = serverWidget.createForm({
      title: 'Convert RTF Signature to Image'
    });

    form.addField({
      id: PARAM_RTF_FILE_ID,
      label: 'RTF File ID',
      type: serverWidget.FieldType.INTEGER
    }).isMandatory = true;

    form.addField({
      id: PARAM_OUTPUT_FOLDER_ID,
      label: 'Output Folder ID',
      type: serverWidget.FieldType.INTEGER
    }).isMandatory = true;

    form.addSubmitButton({
      label: 'Convert'
    });

    context.response.writePage(form);
  }

  function writeResultPage(context, result) {
    const escapedUrl = xmlEscape(result.imageUrl);
    const html = `
      <html>
        <body style="font-family: Arial, sans-serif;">
          <h2>Image Created</h2>
          <p><strong>Image File ID:</strong> ${xmlEscape(result.imageFileId)}</p>
          <p><strong>Image URL:</strong> ${escapedUrl}</p>
          <p><img src="${escapedUrl}" style="max-width: 300px; max-height: 120px;" /></p>
          <h3>PDF Template Example</h3>
          <pre>&lt;img src="\${sig_file_path?html}" style="height: 35px; width: 120px;" /&gt;</pre>
        </body>
      </html>`;

    context.response.write(html);
  }

  function writeErrorPage(context, e) {
    context.response.write(`
      <html>
        <body style="font-family: Arial, sans-serif;">
          <h2>Could Not Convert RTF</h2>
          <p>${xmlEscape(e.message || String(e))}</p>
        </body>
      </html>`);
  }

  function writeJson(context, payload) {
    context.response.setHeader({
      name: 'Content-Type',
      value: 'application/json'
    });
    context.response.write(JSON.stringify(payload));
  }

  function getBaseName(fileName) {
    return String(fileName)
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .substring(0, 80) || 'signature';
  }

  function xmlEscape(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  return {
    onRequest
  };
});
