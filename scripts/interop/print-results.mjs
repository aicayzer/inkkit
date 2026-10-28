export function validatePrint(result, fixture) {
  return ['print', 'printable'].includes(fixture.mode)
    ? [
        ...(result?.print?.pages >= (fixture.printMinPages ?? 1)
          ? []
          : [`Printed PDF has fewer than ${fixture.printMinPages ?? 1} pages`]),
        ...(fixture.printIncludes ?? [])
          .filter((value) => !result?.print?.text?.includes(value))
          .map((value) => `Printed PDF omitted ${value}`),
        ...(fixture.printExcludes ?? [])
          .filter((value) => result?.print?.text?.includes(value))
          .map((value) => `Printed PDF included ${value}`),
        ...(fixture.mode === 'printable' &&
        result?.print?.frozenDocument !== true
          ? ['Print did not use the captured standalone HTML']
          : []),
        ...(fixture.mode === 'printable' &&
        (result?.print?.screenGeometry?.editorComponents !== 0 ||
          result?.print?.screenGeometry?.activeElements !== 0 ||
          result?.print?.screenGeometry?.externalResources?.length !== 0)
          ? [
              'Frozen print document contains editor controls, active elements or external resources',
            ]
          : []),
        ...(fixture.mode === 'printable' &&
        !result?.print?.pageGeometry?.every(
          (page) =>
            Math.abs(page.width - 595.28) < 1 &&
            Math.abs(page.height - 841.89) < 1,
        )
          ? ['Printed pages have unexpected geometry']
          : []),
        ...(fixture.printMinImages &&
        !(
          result?.print?.imageXObjects?.filter(
            (image) =>
              image.width > 0 && image.height > 0 && image.streamBytes > 0,
          ).length >= fixture.printMinImages
        )
          ? ['Printed PDF omitted embedded image streams']
          : []),
        ...(fixture.mode === 'printable'
          ? (
              result?.results?.[fixture.printableName ?? 'printable']
                ?.assetGeometry ?? []
            ).flatMap((asset) =>
              result?.print?.imagePlacements?.some(
                (image) =>
                  image.width === asset.width &&
                  image.height === asset.height &&
                  image.mediaBoxFraction > 0.999 &&
                  image.drawnWidth > 0 &&
                  image.drawnHeight > 0,
              )
                ? []
                : [
                    `Printed PDF has no complete page-contained image placement for ${asset.width}x${asset.height}`,
                  ],
            )
          : []),
        ...(fixture.printPortrait &&
        !result?.print?.imagePlacements?.some((image) => {
          if (
            image.width !== fixture.printPortrait.width ||
            image.height !== fixture.printPortrait.height ||
            image.mediaBoxFraction < 0.999
          )
            return false
          const raster = result?.print?.pageRasters?.find(
            (page) => page.page === image.page && page.image === image.name,
          )?.portrait
          const bands = [
            raster?.red ?? 0,
            raster?.green ?? 0,
            raster?.blue ?? 0,
          ]
          const coverage =
            (raster?.colourPixels ?? 0) / (image.drawnWidth * image.drawnHeight)
          return (
            raster?.rendered === true &&
            Math.min(...bands) > 100 &&
            Math.max(...bands) / Math.min(...bands) < 1.06 &&
            coverage > 0.95 &&
            coverage < 1.05
          )
        })
          ? [
              'Native PDF raster does not show all equal portrait bands covering the complete drawn image area',
            ]
          : []),
      ]
    : []
}
